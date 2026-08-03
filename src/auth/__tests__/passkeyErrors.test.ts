import { describe, expect, it } from "bun:test";
import { ApiError } from "@/domain/api";
import {
  classifyPasskeyError,
  classifyPasskeyFailure,
  isPasskeyCeremonyError,
  passkeyErrorMessage,
  PasskeyCeremonyError,
  PasskeyDataError,
  PASSKEY_ERROR_KEYS,
} from "../passkeyErrors";

/** expo-modules shape: a coded error, `code` derived from the Swift class. */
const iosError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

/** Android shape: the code is the ceremony, the MESSAGE carries the token. */
const androidError = (message: string): Error =>
  Object.assign(new Error(message), { code: "Passkey Get" });

/** Web / react-native-web shape: a DOMException-like `name`. */
const webError = (name: string): Error => {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = name;
  return error;
};

describe("classifyPasskeyError: iOS", () => {
  it("reads a dismissal off ERR_USER_CANCELLED", () => {
    expect(
      classifyPasskeyError(iosError("ERR_USER_CANCELLED", "User cancelled the passkey interaction")),
    ).toBe("cancelled");
  });

  it("reads a missing associated domain off ERR_NOT_CONFIGURED", () => {
    expect(
      classifyPasskeyError(
        iosError("ERR_NOT_CONFIGURED", "Your Apple app site association is not properly configured."),
      ),
    ).toBe("domain");
  });

  it("reads an old OS off ERR_NOT_SUPPORTED", () => {
    expect(
      classifyPasskeyError(
        iosError("ERR_NOT_SUPPORTED", "Passkeys are not supported on this iOS version."),
      ),
    ).toBe("unsupported");
  });

  it("reads a simulator with no enrolled biometrics off ERR_BIOMETRIC", () => {
    expect(classifyPasskeyError(iosError("ERR_BIOMETRIC", "Biometrics must be enabled"))).toBe(
      "noAuthenticator",
    );
  });

  it("reads a ceremony already on screen off ERR_PENDING_PASSKEY_REQUEST", () => {
    expect(
      classifyPasskeyError(
        iosError("ERR_PENDING_PASSKEY_REQUEST", "There is already a pending passkey request"),
      ),
    ).toBe("busy");
  });

  it("falls back to failed for the generic request failure", () => {
    expect(
      classifyPasskeyError(iosError("ERR_PASSKEY_REQUEST_FAILED", "The passkey request failed")),
    ).toBe("failed");
    expect(classifyPasskeyError(iosError("ERR_UNKNOWN", "An unknown exception occured"))).toBe(
      "failed",
    );
  });
});

describe("classifyPasskeyError: Android", () => {
  it("maps the message tokens the Kotlin module emits", () => {
    expect(classifyPasskeyError(androidError("UserCancelled"))).toBe("cancelled");
    expect(classifyPasskeyError(androidError("NoCredentials"))).toBe("noCredentials");
    expect(classifyPasskeyError(androidError("NotSupported"))).toBe("unsupported");
    expect(classifyPasskeyError(androidError("Interrupted"))).toBe("failed");
    expect(classifyPasskeyError(androidError("UnknownError"))).toBe("failed");
  });

  it("treats a provider configuration failure as unavailable, not as a domain fault", () => {
    // CreateCredentialProviderConfigurationException means there is no
    // credential manager on the device; the domain files are irrelevant to it.
    expect(classifyPasskeyError(androidError("NotConfigured"))).toBe("unavailable");
  });

  it("treats a SecurityError DOM exception as the domain fault it is", () => {
    expect(
      classifyPasskeyError(
        androidError("DomError: SecurityError - The incoming request cannot be validated"),
      ),
    ).toBe("domain");
  });

  it("recognises an already-enrolled authenticator", () => {
    expect(classifyPasskeyError(androidError("DomError: InvalidStateError - already"))).toBe(
      "alreadyRegistered",
    );
  });
});

describe("classifyPasskeyError: web and edge cases", () => {
  it("maps the standard WebAuthn DOMException names", () => {
    expect(classifyPasskeyError(webError("NotAllowedError"))).toBe("cancelled");
    expect(classifyPasskeyError(webError("SecurityError"))).toBe("domain");
    expect(classifyPasskeyError(webError("NotSupportedError"))).toBe("unsupported");
    expect(classifyPasskeyError(webError("InvalidStateError"))).toBe("alreadyRegistered");
  });

  it("does NOT treat AbortError as a cancellation", () => {
    // The HTTP client aborts its own fetches on timeout with that exact name;
    // swallowing it as "the user changed their mind" would hide a real fault.
    expect(classifyPasskeyError(webError("AbortError"))).toBe("failed");
  });

  it("recognises an unlinked native module", () => {
    expect(classifyPasskeyError(new Error("Cannot find native module 'ReactNativePasskeys'"))).toBe(
      "unavailable",
    );
  });

  it("passes a already-classified ceremony error straight through", () => {
    expect(classifyPasskeyError(new PasskeyCeremonyError("domain"))).toBe("domain");
  });

  it("treats a malformed payload as a generic failure", () => {
    expect(classifyPasskeyError(new PasskeyDataError("options.challenge: not base64"))).toBe(
      "failed",
    );
  });

  it("never throws on junk", () => {
    expect(classifyPasskeyError(undefined)).toBe("failed");
    expect(classifyPasskeyError(null)).toBe("failed");
    expect(classifyPasskeyError(7)).toBe("failed");
    expect(classifyPasskeyError({})).toBe("failed");
    expect(classifyPasskeyError("UserCancelled")).toBe("cancelled");
  });
});

describe("isPasskeyCeremonyError", () => {
  it("narrows only real ceremony errors", () => {
    expect(isPasskeyCeremonyError(new PasskeyCeremonyError("busy"))).toBe(true);
    expect(isPasskeyCeremonyError(new Error("busy"))).toBe(false);
    expect(isPasskeyCeremonyError(null)).toBe(false);
  });

  it("keeps the original error as the cause", () => {
    const cause = new Error("root");
    expect(new PasskeyCeremonyError("failed", cause).cause).toBe(cause);
  });
});

describe("classifyPasskeyFailure", () => {
  it("says nothing at all when the user dismissed the sheet", () => {
    const info = classifyPasskeyFailure(new PasskeyCeremonyError("cancelled"));
    expect(info.key).toBeNull();
    expect(passkeyErrorMessage(info, (key) => key)).toBeNull();
  });

  it("gives each platform failure its own distinct message key", () => {
    const kinds = [
      "noCredentials",
      "unsupported",
      "domain",
      "noAuthenticator",
      "unavailable",
      "alreadyRegistered",
      "busy",
      "failed",
    ] as const;
    const keys = kinds.map((kind) => classifyPasskeyFailure(new PasskeyCeremonyError(kind)).key);
    expect(new Set(keys).size).toBe(kinds.length);
    for (const kind of kinds) {
      expect(classifyPasskeyFailure(new PasskeyCeremonyError(kind)).key).toBe(
        PASSKEY_ERROR_KEYS[kind],
      );
    }
  });

  it("parks the button for the server's retry_after on a 429", () => {
    const info = classifyPasskeyFailure(
      new ApiError(429, "rate_limited", { retryAfter: 37, body: { retry_after: 37 } }),
    );
    expect(info.key).toBe("native.common.rateLimited");
    expect(info.params).toEqual({ seconds: 37 });
    expect(info.retryAfter).toBe(37);
  });

  it("falls back to a minute when the 429 carries no retry_after", () => {
    expect(classifyPasskeyFailure(new ApiError(429, "rate_limited")).retryAfter).toBe(60);
  });

  it("tells the four 401s of the login ceremony apart", () => {
    const at = (body: string) => classifyPasskeyFailure(new ApiError(401, body, { body })).key;
    expect(at("This account is deactivated.")).toBe("native.auth.passkey.errors.deactivated");
    expect(at("Login challenge expired. Please try again.")).toBe(
      "native.auth.passkey.errors.challengeExpired",
    );
    expect(at("Unknown passkey.")).toBe("native.auth.passkey.errors.unknownPasskey");
    expect(at("Passkey could not be verified.")).toBe("native.auth.passkey.errors.rejected");
  });

  it("reads the registration 400s", () => {
    const body = "External has already been taken";
    expect(classifyPasskeyFailure(new ApiError(400, body, { body })).key).toBe(
      "native.auth.passkey.errors.alreadyRegistered",
    );
    const rejected = "Passkey registration could not be verified.";
    expect(classifyPasskeyFailure(new ApiError(400, rejected, { body: rejected })).key).toBe(
      "native.auth.passkey.errors.rejected",
    );
  });

  it("maps a delete of a passkey that is already gone", () => {
    const body = "Passkey not found.";
    expect(classifyPasskeyFailure(new ApiError(404, body, { body })).key).toBe(
      "native.auth.passkey.errors.notFound",
    );
  });

  it("says offline for a dropped connection", () => {
    expect(classifyPasskeyFailure(new ApiError(0, "Not authenticated")).key).toBe(
      "native.common.offline",
    );
    const network = new TypeError("Network request failed");
    expect(classifyPasskeyFailure(network).key).toBe("native.common.offline");
  });

  it("falls back to the generic failure for a 5xx", () => {
    expect(classifyPasskeyFailure(new ApiError(500, "boom")).key).toBe(
      "native.auth.passkey.errors.failed",
    );
  });

  it("renders through a t-shaped translator with its params", () => {
    const info = classifyPasskeyFailure(new ApiError(429, "rate_limited", { retryAfter: 12 }));
    expect(
      passkeyErrorMessage(info, (key, params) => `${key}:${JSON.stringify(params ?? {})}`),
    ).toBe('native.common.rateLimited:{"seconds":12}');
  });
});
