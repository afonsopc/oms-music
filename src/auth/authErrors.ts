/**
 * Truthful auth error copy. Pure, so it is unit tested without a device.
 *
 * Sign-in is Pocket ID only, so the one auth endpoint the app still calls
 * itself is the ticket exchange. Provider-side refusals (account_exists,
 * email_unverified, ...) arrive as `?error=<code>` on the callback URL and
 * are mapped by `oauthCallback.ts#oauthErrorKey`, not here.
 *
 * POST /sessions/adopt (`sessions_controller.rb:45-52`)
 *   401  "Invalid or expired ticket." - the signed id lives 2 minutes.
 *   429  {"error":"rate_limited","retry_after":N}
 */
import { isApiError } from "@/domain/api";

export type AuthErrorCode =
  | "ticketExpired"
  | "rateLimited"
  | "serverError"
  | "offline"
  | "unknown";

export const AUTH_ERROR_KEYS: Record<AuthErrorCode, string> = {
  ticketExpired: "native.auth.errors.ticketExpired",
  rateLimited: "native.common.rateLimited",
  serverError: "native.auth.errors.serverError",
  offline: "native.common.offline",
  unknown: "native.common.unknownError",
};

export interface AuthErrorInfo {
  code: AuthErrorCode;
  /** ICU params for AUTH_ERROR_KEYS[code]. */
  params: Record<string, string | number>;
  /** A bare server string worth rendering verbatim (validation messages). */
  detail?: string;
}

/** Longest server string we are willing to put in front of a user. */
const MAX_DETAIL_LENGTH = 200;

const statusOf = (error: unknown): number | null => (isApiError(error) ? error.status : null);

/** The server's bare-string body, when it is one and it is presentable. */
export const serverDetail = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;
  const body = error.body;
  if (typeof body !== "string") return undefined;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_DETAIL_LENGTH) return undefined;
  return trimmed;
};

/**
 * A dropped connection or a timeout. `request()` lets fetch's own rejection
 * through untouched, so this is not always an ApiError: React Native throws
 * `TypeError: Network request failed`, and the 20s AbortController throws an
 * AbortError.
 */
export const isNetworkFailure = (error: unknown): boolean => {
  if (isApiError(error)) return error.status === 0;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TypeError") return true;
    return /network request failed|failed to fetch|network error|timed? ?out/i.test(error.message);
  }
  return false;
};

/** Statuses every auth endpoint shares. Returns null when it does not apply. */
const classifyShared = (error: unknown): AuthErrorInfo | null => {
  if (isNetworkFailure(error)) return { code: "offline", params: {} };
  const status = statusOf(error);
  if (status === null) return { code: "unknown", params: {} };
  if (status === 429) {
    const seconds = isApiError(error) ? (error.retryAfter ?? 60) : 60;
    return { code: "rateLimited", params: { seconds } };
  }
  if (status >= 500) return { code: "serverError", params: {} };
  return null;
};

const unknownWithDetail = (error: unknown): AuthErrorInfo => ({
  code: "unknown",
  params: {},
  detail: serverDetail(error),
});

/** POST /sessions/adopt, after the WebView handed back a ticket. */
export const classifyAdoptError = (error: unknown): AuthErrorInfo => {
  const shared = classifyShared(error);
  if (shared) return shared;
  if (statusOf(error) === 401) return { code: "ticketExpired", params: {} };
  return unknownWithDetail(error);
};

/** Renders an AuthErrorInfo through any `t`-shaped translator. */
export const authErrorMessage = (
  info: AuthErrorInfo,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string => info.detail ?? translate(AUTH_ERROR_KEYS[info.code], info.params);
