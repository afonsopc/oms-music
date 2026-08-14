/**
 * The one HTTP client (DESIGN.md section 5, frozen contract). All wire logic
 * funnels through request(); endpoints modules are thin typed wrappers.
 */
import { buildApiError } from "./errors";
import { deepNullToSentinel, encodeQuery } from "./params";
import { ApiError } from "@/domain/api";
import { isCookieAuth } from "@/auth/authMode";
import { getToken } from "@/auth/token";
import { buildUserAgent } from "@/auth/userAgent";

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? "https://backend.omelhorsite.pt";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOpts {
  /** GET query, bracket-encoded, null -> "\b". */
  params?: Record<string, unknown>;
  /** JSON body, deep null -> "\b" rewrite. */
  body?: unknown;
  /** Multipart, sent VERBATIM (sentinel exempt). */
  formData?: FormData;
  /** Skip the sentinel rewrite (WebAuthn ceremonies). */
  raw?: boolean;
  /** Default true; false for public endpoints. */
  auth?: boolean;
  /** Default 20s; imports pass 120s+. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Auth-failure hook: any 401 from an authed endpoint (and any media 404
 * while believed-authed - the media routes answer 404, never 401, so
 * existence never leaks) notifies the guard, which runs ONE single-flight
 * /sessions/mine probe. Registered by auth/guard.ts; callers never retry.
 */
type AuthFailureHandler = (cause: "401" | "fs404") => void;
let authFailureHandler: AuthFailureHandler = () => {};
export const setAuthFailureHandler = (handler: AuthFailureHandler): void => {
  authFailureHandler = handler;
};

const isMediaPath = (path: string): boolean => path.startsWith("/media/");

export async function request<T>(
  method: HttpMethod,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const auth = opts.auth !== false;
  // Cookie origins (music.omelhorsite.pt, plano F2 / 2.2) authenticate with
  // the httpOnly same-site session cookie: every request goes out with
  // credentials "include" and never a Bearer header. Everywhere else the
  // stored token rides as Bearer, exactly as before.
  const cookieAuth = isCookieAuth();
  const token = getToken();

  if (auth && !token && !cookieAuth) {
    // Never let a token-less request reach the network: invalid/absent tokens
    // count against the anonymous 120/min/IP bucket. On a cookie origin there
    // is no readable credential to gate on - the cookie is httpOnly - so the
    // request goes out and a dead session comes back as a plain 401.
    throw new ApiError(0, "Not authenticated");
  }

  let url = `${API_BASE_URL}${path}`;
  if (opts.params) {
    const query = encodeQuery(
      (opts.raw ? opts.params : deepNullToSentinel(opts.params)) as Record<string, unknown>,
    );
    if (query) url += (url.includes("?") ? "&" : "?") + query;
  }

  const headers: Record<string, string> = {
    "User-Agent": buildUserAgent(),
  };
  // Never send Bearer next to the cookie: the API reads header/param BEFORE
  // the cookie, so a stale token would shadow a fresh session (the exact
  // lockout the site's purgeLegacyToken exists to clean up).
  if (auth && token && !cookieAuth) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // verbatim; fetch sets the multipart boundary
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.raw ? opts.body : deepNullToSentinel(opts.body));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // The timeout stays armed across the BODY read too: a server that sends
  // headers and then stalls the body would otherwise hang this promise
  // forever, and a hung resolveDataUrl is a permanent player spinner.
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      // "include" on EVERY call in cookie mode, auth:false ones too: the
      // Set-Cookie on /sessions and /sessions/adopt is only processed by the
      // browser when the response is credentialed. Elsewhere undefined keeps
      // today's behavior untouched.
      credentials: cookieAuth ? "include" : undefined,
    });

    if (response.status === 204) return undefined as T;

    if (response.status === 304) {
      // The client sends no validators; if the native stack still surfaces a
      // 304, the query layer resolves it with the previous data (DESIGN 5.6).
      throw new ApiError(304, "Not modified");
    }

    text = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (response.ok) return parsed as T;

  if (auth && response.status === 401) authFailureHandler("401");
  if (auth && response.status === 404 && isMediaPath(path)) authFailureHandler("fs404");

  throw buildApiError(response.status, parsed, response.headers.get("Retry-After"));
}

/** GET returning raw binary (metadata modifier tool). */
export async function requestBinary(
  method: HttpMethod,
  path: string,
  opts: RequestOpts = {},
): Promise<Blob> {
  // Same two auth modes as request() above: cookie origins ride the session
  // cookie (no readable token to gate on), everything else requires Bearer.
  const cookieAuth = isCookieAuth();
  const token = getToken();
  if (!token && !cookieAuth) throw new ApiError(0, "Not authenticated");
  const headers: Record<string, string> = {
    "User-Agent": buildUserAgent(),
  };
  if (token && !cookieAuth) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: opts.formData,
      signal: controller.signal,
      credentials: cookieAuth ? "include" : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text
      }
      throw buildApiError(response.status, parsed, response.headers.get("Retry-After"));
    }
    return await response.blob();
  } finally {
    clearTimeout(timeout);
  }
}
