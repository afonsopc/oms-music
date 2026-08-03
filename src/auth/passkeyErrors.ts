/**
 * Passkey failure taxonomy (FR-13). Pure, so every branch is unit tested
 * without a device, and it reuses `authErrors`' primitives rather than
 * re-deriving "is this offline" or "is this body worth showing".
 *
 * A passkey attempt can fail in two unrelated worlds and they must not be
 * flattened into one "Something went wrong":
 *
 *  A. THE PLATFORM. Three surfaces, none of which agrees on a shape, so the
 *     classifier reads `code`, `name` and `message` together:
 *      - iOS: expo-modules turns a Swift `Exception` into a JS error whose
 *        `code` is derived from the class name, so `UserCancelledException`
 *        arrives as `ERR_USER_CANCELLED` and `NotConfiguredException` (the
 *        ASAuthorization 4004 "app is not associated with domain" case) as
 *        `ERR_NOT_CONFIGURED`
 *        (node_modules/react-native-passkeys/ios/PasskeyExceptions.swift,
 *        node_modules/expo-modules-core/ios/Core/Exceptions/CodedError.swift:45).
 *      - Android: it rejects with code "Passkey Get"/"Passkey Create" and the
 *        MESSAGE carries the token ("UserCancelled", "NoCredentials",
 *        "NotConfigured", "NotSupported", "DomError: SecurityError - ...").
 *      - Web/react-native-web: a DOMException whose `name` is the standard
 *        WebAuthn one ("NotAllowedError", "SecurityError", "InvalidStateError").
 *
 *  B. THE API. The four endpoints answer bare JSON strings, and the four 401s
 *     of the login ceremony mean four different things
 *     (`webauthn_credentials_controller.rb:75, :80, :91, :99-101`). Matching on
 *     the server's own sentence is the only signal there is, and it is the same
 *     thing `classifyCodeSubmitError` does for "User not found."
 *
 * Two deliberate calls in the platform half:
 *  - `AbortError` is NOT a cancellation. The HTTP client aborts its own fetches
 *    on timeout with exactly that name, and a timed-out request must not be
 *    silently swallowed as "the user changed their mind". Only the real cancel
 *    tokens count.
 *  - Android's `NotConfigured` is a *provider* problem (no credential manager
 *    on the device) and maps to `unavailable`, while iOS's `ERR_NOT_CONFIGURED`
 *    and any `SecurityError` map to `domain`. During rollout the domain files
 *    may not be live yet, so that distinction is the difference between a
 *    useful message and a lie.
 */
import { isApiError } from "@/domain/api";
import { isNetworkFailure, serverDetail } from "./authErrors";

export type PasskeyFailureKind =
  /** The user dismissed the system sheet. Never worth shouting about. */
  | "cancelled"
  /** The device holds no passkey for this relying party. */
  | "noCredentials"
  /** excludeCredentials matched: this device already has a passkey here. */
  | "alreadyRegistered"
  /** OS too old (iOS < 15, Android API < 28). */
  | "unsupported"
  /** No biometrics / device passcode enrolled (bare simulators land here). */
  | "noAuthenticator"
  /** Associated domain missing or wrong: AASA, assetlinks.json, or rp id. */
  | "domain"
  /** No passkey provider at all, or the native module is not linked. */
  | "unavailable"
  /** A ceremony is already on screen. */
  | "busy"
  /** Anything else, including a malformed payload. */
  | "failed";

const messageKey = (name: string): string => `native.auth.passkey.errors.${name}`;

/** Every kind except `cancelled`, which is rendered as silence. */
export const PASSKEY_ERROR_KEYS: Record<Exclude<PasskeyFailureKind, "cancelled">, string> = {
  noCredentials: messageKey("noCredentials"),
  alreadyRegistered: messageKey("alreadyRegistered"),
  unsupported: messageKey("unsupported"),
  noAuthenticator: messageKey("noAuthenticator"),
  domain: messageKey("domain"),
  unavailable: messageKey("unavailable"),
  busy: messageKey("busy"),
  failed: messageKey("failed"),
};

/** A ceremony payload from either end of the wire did not parse. */
export class PasskeyDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyDataError";
  }
}

/**
 * The classified outcome of a platform ceremony. Raised only around the native
 * `create()` / `get()` calls and the payload normalisation, so an ApiError from
 * the four HTTP endpoints keeps flowing to the screens untouched.
 */
export class PasskeyCeremonyError extends Error {
  readonly kind: PasskeyFailureKind;

  constructor(kind: PasskeyFailureKind, cause?: unknown) {
    super(`Passkey ceremony failed: ${kind}`);
    this.name = "PasskeyCeremonyError";
    this.kind = kind;
    this.cause = cause;
  }
}

export const isPasskeyCeremonyError = (error: unknown): error is PasskeyCeremonyError =>
  error instanceof PasskeyCeremonyError;

// ---------------------------------------------------------------------------
// Platform errors
// ---------------------------------------------------------------------------

const field = (source: Record<string, unknown>, key: string): string =>
  typeof source[key] === "string" ? (source[key] as string) : "";

/**
 * Lowercased, punctuation-free join of code + name + message. Collapsing the
 * separators is what lets one token match both `ERR_NOT_SUPPORTED` (the iOS
 * code) and `NotSupported` (the Android message).
 */
const fingerprint = (error: unknown): string => {
  if (typeof error === "string") return error.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!error || typeof error !== "object") return "";
  const source = error as Record<string, unknown>;
  return [field(source, "code"), field(source, "name"), field(source, "message")]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

export const classifyPasskeyError = (error: unknown): PasskeyFailureKind => {
  if (error instanceof PasskeyCeremonyError) return error.kind;
  if (error instanceof PasskeyDataError) return "failed";

  const marks = fingerprint(error);
  const has = (...tokens: string[]): boolean => tokens.some((token) => marks.includes(token));

  // Order matters: `errnotconfigured` contains `notconfigured`, so the iOS
  // domain case has to be tested before the Android provider case.
  if (has("usercancelled", "usercanceled", "notallowederror")) return "cancelled";
  if (has("nocredential")) return "noCredentials";
  if (has("invalidstateerror", "matchedexcludedcredential")) return "alreadyRegistered";
  if (has("biometric")) return "noAuthenticator";
  if (has("errnotconfigured", "appsiteassociation", "securityerror", "notassociatedwithdomain"))
    return "domain";
  if (has("notsupported")) return "unsupported";
  if (has("cannotfindnativemodule", "notconfigured", "nocredentialmanager")) return "unavailable";
  if (has("pendingpasskeyrequest")) return "busy";
  return "failed";
};

// ---------------------------------------------------------------------------
// One entry point for the screens
// ---------------------------------------------------------------------------

export interface PasskeyErrorInfo {
  /** i18n key, or null when the right thing to show is nothing at all. */
  key: string | null;
  /** ICU params for `key`. */
  params: Record<string, string | number>;
  /** Seconds the button must stay parked. Set for 429 only. */
  retryAfter?: number;
}

const SILENT: PasskeyErrorInfo = { key: null, params: {} };

const info = (name: string): PasskeyErrorInfo => ({ key: messageKey(name), params: {} });

/**
 * Turns anything a passkey flow can throw into one message.
 *
 * The 429 branch carries `retryAfter` because the login ceremony spends TWO
 * requests from the same 20/min per-IP bucket (rack_attack.rb:48-50 throttles
 * every path under /webauthn_credentials/authentication, which covers both
 * `_options` and the assertion), so roughly ten attempts a minute is the real
 * ceiling and the button parks itself rather than retrying into the wall.
 */
export const classifyPasskeyFailure = (error: unknown): PasskeyErrorInfo => {
  if (error instanceof PasskeyCeremonyError) {
    return error.kind === "cancelled" ? SILENT : { key: PASSKEY_ERROR_KEYS[error.kind], params: {} };
  }
  if (isNetworkFailure(error)) return { key: "native.common.offline", params: {} };
  if (!isApiError(error)) return info("failed");

  if (error.status === 429) {
    const seconds = error.retryAfter ?? 60;
    return { key: "native.common.rateLimited", params: { seconds }, retryAfter: seconds };
  }

  const detail = serverDetail(error) ?? "";

  // The login ceremony's four 401s (controller :75, :80, :91, :99-101).
  if (error.status === 401) {
    if (/deactivated/i.test(detail)) return info("deactivated");
    if (/challenge expired/i.test(detail)) return info("challengeExpired");
    if (/unknown passkey/i.test(detail)) return info("unknownPasskey");
    return info("rejected");
  }

  // Registration: 400 is either a verification failure or the uniqueness
  // validation on external_id, i.e. this authenticator is already enrolled.
  if (error.status === 400) {
    return /taken/i.test(detail) ? info("alreadyRegistered") : info("rejected");
  }

  // DELETE /webauthn_credentials/:id on a passkey that is already gone.
  if (error.status === 404) return info("notFound");

  return info("failed");
};

/** Renders a PasskeyErrorInfo through any `t`-shaped translator. */
export const passkeyErrorMessage = (
  errorInfo: PasskeyErrorInfo,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string | null => (errorInfo.key === null ? null : translate(errorInfo.key, errorInfo.params));
