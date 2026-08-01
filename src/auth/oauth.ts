/**
 * OAuth ticket flow (FR-12). The backend's callback redirect is hardcoded to
 * https://omelhorsite.pt/account/oauth/callback?ticket=...|?error=<code>; a
 * WebView (WP2) renders /auth/<provider>?mode=signin and intercepts that URL
 * with parseOAuthCallback, then calls adoptTicket. Spotify account LINKING
 * reuses the WebView against /auth/link/spotify?token=<session token>.
 *
 * Passkeys (FR-13) are deferred: the WebAuthn endpoints require `raw: true`
 * payloads (sentinel bypass) and associated domains that do not exist yet.
 */
import { API_BASE_URL, request } from "@/api/client";
import type { User } from "@/domain/user";
import { getToken, setToken } from "./token";

export type OAuthProvider = "google_oauth2" | "github" | "spotify";
export type OAuthMode = "signin" | "signup" | "link";

export const OAUTH_CALLBACK_PREFIX = "https://omelhorsite.pt/account/oauth/callback";

export type OAuthErrorCode =
  | "account_exists"
  | "account_not_found"
  | "unauthorized"
  | "conflict"
  | "internal"
  | "spotify_not_allowlisted"
  | "oauth_state"
  | "oauth_failed";

/** i18n keys for the error codes; screens resolve them through t(). */
export const OAUTH_ERROR_KEYS: Record<OAuthErrorCode, string> = {
  account_exists: "native.auth.oauthErrors.accountExists",
  account_not_found: "native.auth.oauthErrors.accountNotFound",
  unauthorized: "native.auth.oauthErrors.unauthorized",
  conflict: "native.auth.oauthErrors.conflict",
  internal: "native.auth.oauthErrors.internal",
  spotify_not_allowlisted: "native.auth.oauthErrors.spotifyNotAllowlisted",
  oauth_state: "native.auth.oauthErrors.oauthFailed",
  oauth_failed: "native.auth.oauthErrors.oauthFailed",
};

export const buildOAuthUrl = (provider: OAuthProvider, mode: OAuthMode): string =>
  `${API_BASE_URL}/auth/${provider}?mode=${mode}`;

/** Spotify linking while signed in passes the raw session token. */
export const buildLinkUrl = (provider: OAuthProvider): string => {
  const token = getToken();
  return `${API_BASE_URL}/auth/link/${provider}?token=${encodeURIComponent(token ?? "")}`;
};

export type OAuthCallbackResult =
  | { kind: "ticket"; ticket: string }
  | { kind: "error"; error: OAuthErrorCode | string }
  | null;

/**
 * Pure URL inspection for onShouldStartLoadWithRequest: returns null when the
 * URL is not the callback; otherwise the extracted ticket or error code.
 */
export const parseOAuthCallback = (url: string): OAuthCallbackResult => {
  if (!url.startsWith(OAUTH_CALLBACK_PREFIX)) return null;
  const queryStart = url.indexOf("?");
  const query = queryStart >= 0 ? url.slice(queryStart + 1) : "";
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : "";
    params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " ")));
  }
  const ticket = params.get("ticket");
  if (ticket) return { kind: "ticket", ticket };
  const error = params.get("error");
  if (error) return { kind: "error", error };
  return { kind: "error", error: "oauth_failed" };
};

/** POST /sessions/adopt { ticket } (2 min TTL) -> stores the session token. */
export const adoptTicket = async (ticket: string): Promise<void> => {
  const response = await request<{ token: string }>("POST", "/sessions/adopt", {
    body: { ticket },
    auth: false,
  });
  await setToken(response.token);
};

/** GET /identities (linked identity management). */
export interface Identity {
  id: string;
  provider: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export const listIdentities = (): Promise<Identity[]> => request("GET", "/identities");

export const deleteIdentity = (id: string): Promise<void> =>
  request("DELETE", `/identities/${encodeURIComponent(id)}`);

/**
 * Passkey contract stub (FR-13, P2): payloads must be sent VERBATIM with
 * `raw: true` - the sentinel rewrite corrupts WebAuthn ceremonies. Not wired
 * to any UI in v1 (no associated domains).
 */
export const webauthnAuthenticationOptions = (): Promise<{
  handle: string;
  options: unknown;
}> =>
  request("POST", "/webauthn_credentials/authentication_options", {
    body: {},
    raw: true,
    auth: false,
  });

export const webauthnAuthenticate = (
  credential: unknown,
  handle: string,
): Promise<{ token?: string; user?: User }> =>
  request("POST", "/webauthn_credentials/authentication", {
    body: { credential, handle },
    raw: true,
    auth: false,
  });
