/**
 * Truthful auth error copy. Pure, so it is unit tested without a device.
 *
 * The API answers auth failures in four different shapes and the screens used
 * to flatten three of them into "Something went wrong". Every branch below is
 * anchored to the server code that produces it.
 *
 * POST /sessions (`sessions_controller.rb:23-30`)
 *   401  bare string "Invalid email address or password."
 *   422  DEACTIVATED ACCOUNT, and the body is EMPTY. `authenticate_by` still
 *        returns the user, then `sessions.create!` trips the
 *        `user_not_deactivated` validation (`session.rb:103-107`) and raises
 *        `ActiveRecord::RecordInvalid`. That is not an `HttpExit`, so
 *        `ErrorReporting` re-raises it (`error_reporting.rb:5-15`) and Rails'
 *        `ShowExceptions` renders it: the app sends no `Accept` header, so
 *        `request.formats.first` is `text/html`, `PublicExceptions#render_html`
 *        looks for `public/422.html`, the backend's `public/` holds only
 *        robots.txt, and the middleware falls through to `pass_response(422)` -
 *        status 422, `text/plain`, zero bytes. Nothing but the status code is
 *        available to classify on.
 *   429  {"error":"rate_limited","retry_after":N}, 10/min per IP
 *        (`rack_attack.rb:30-32`)
 *   500  ONLY reachable by omitting the `password` key entirely:
 *        `User.authenticate_by` raises ArgumentError("One or more password
 *        arguments are required"). `login()` refuses to send such a body, so
 *        this is a belt-and-braces mapping.
 *
 * POST /sessions/adopt (`sessions_controller.rb:45-52`)
 *   401  "Invalid or expired ticket." - the signed id lives 2 minutes.
 *
 * POST /users/{create,reset_password}_end (`users_controller.rb:115-141`)
 *   404  "Invalid Verification" for a WRONG code, an EXPIRED code and a BURNED
 *        code alike. The server never distinguishes them, so the client's own
 *        `OtpBudget` picks the explanation (see auth/otp.ts).
 *   404  "User not found." on reset only, when the email has no account.
 *   422  bare-string `error_messages`, e.g. "Password is too short"; worth
 *        showing verbatim.
 *
 * POST /users/create_start (`users_controller.rb:108-113`)
 *   409  "Email already registered."
 *   422  bare-string `error_messages` (bad address format).
 */
import { isApiError } from "@/domain/api";
import { otpAttemptsLeft, otpState, type OtpBudget } from "./otp";

export type AuthErrorCode =
  | "invalidCredentials"
  | "accountDeactivated"
  | "missingPassword"
  | "emailTaken"
  | "accountNotFound"
  | "codeInvalid"
  | "codeExpired"
  | "codeBurned"
  | "ticketExpired"
  | "rateLimited"
  | "serverError"
  | "offline"
  | "unknown";

export const AUTH_ERROR_KEYS: Record<AuthErrorCode, string> = {
  invalidCredentials: "native.auth.login.invalidCredentials",
  accountDeactivated: "native.auth.errors.accountDeactivated",
  missingPassword: "native.auth.errors.missingPassword",
  emailTaken: "native.auth.signup.emailTaken",
  accountNotFound: "native.auth.errors.accountNotFound",
  codeInvalid: "native.auth.errors.codeInvalid",
  codeExpired: "native.auth.errors.codeExpired",
  codeBurned: "native.auth.errors.codeBurned",
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

/**
 * Raised by `login()` rather than letting a body without a `password` key
 * reach POST /sessions, where it becomes a 500 plus a Discord error alert.
 * Lives here (not in session.ts) so the classifier stays dependency free.
 */
export class MissingCredentialsError extends Error {
  constructor() {
    super("Email and password are required");
    this.name = "MissingCredentialsError";
  }
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

/**
 * POST /sessions.
 *
 * Note what is NOT mapped: a 500 stays `serverError`. The only way this
 * endpoint 500s on a well-formed client is an absent `password` key, and
 * `login()` refuses to send one, so telling a user who typed both fields to
 * "enter both fields" would be a lie. `missingPassword` is reserved for the
 * local refusal.
 */
export const classifyLoginError = (error: unknown): AuthErrorInfo => {
  if (error instanceof MissingCredentialsError) return { code: "missingPassword", params: {} };
  const shared = classifyShared(error);
  if (shared) return shared;
  const status = statusOf(error);
  if (status === 401) return { code: "invalidCredentials", params: {} };
  if (status === 422) return { code: "accountDeactivated", params: {} };
  return unknownWithDetail(error);
};

/** POST /sessions/adopt, after the WebView handed back a ticket. */
export const classifyAdoptError = (error: unknown): AuthErrorInfo => {
  const shared = classifyShared(error);
  if (shared) return shared;
  if (statusOf(error) === 401) return { code: "ticketExpired", params: {} };
  return unknownWithDetail(error);
};

/** POST /users/{create,reset_password,...}_start. */
export const classifyCodeRequestError = (error: unknown): AuthErrorInfo => {
  const shared = classifyShared(error);
  if (shared) return shared;
  if (statusOf(error) === 409) return { code: "emailTaken", params: {} };
  return unknownWithDetail(error);
};

/**
 * POST /users/{create,reset_password}_end.
 *
 * `budget` must already be charged for THIS guess (call `otpWrongGuess` before
 * classifying), because the server charged it too: `EmailVerification.verify`
 * burns an attempt on every miss and destroys the row on the fifth
 * (`email_verification.rb:46-58`, `:71-82`).
 */
export const classifyCodeSubmitError = (
  error: unknown,
  budget: OtpBudget,
  now: number,
): AuthErrorInfo => {
  const shared = classifyShared(error);
  if (shared) return shared;
  const status = statusOf(error);
  if (status === 404) {
    const detail = serverDetail(error);
    // Only the reset flow can answer this, and it is not the code's fault.
    if (detail && /user not found/i.test(detail)) return { code: "accountNotFound", params: {} };
    const state = otpState(budget, now);
    if (state === "burned") return { code: "codeBurned", params: {} };
    if (state === "expired") return { code: "codeExpired", params: {} };
    return { code: "codeInvalid", params: { attempts: otpAttemptsLeft(budget) } };
  }
  // 422 is a validation failure on the account itself (password too short,
  // name too long) and arrives as a bare string; the server's own sentence is
  // the most useful thing to say, so it falls through to the detail path.
  return unknownWithDetail(error);
};

/** Renders an AuthErrorInfo through any `t`-shaped translator. */
export const authErrorMessage = (
  info: AuthErrorInfo,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string => info.detail ?? translate(AUTH_ERROR_KEYS[info.code], info.params);
