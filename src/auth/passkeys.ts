/**
 * Passkeys (FR-13): the four existing backend endpoints plus the platform
 * ceremony, wired through react-native-passkeys.
 *
 * Two things about this file are load-bearing.
 *
 * 1. The native module is loaded LAZILY and defensively. react-native-passkeys
 *    calls `requireNativeModule("ReactNativePasskeys")` at module scope
 *    (node_modules/react-native-passkeys/build/ReactNativePasskeysModule.js),
 *    and expo-modules-core's requireNativeModule THROWS when the module is not
 *    linked. A plain top-level import would therefore take the whole bundle
 *    down in Expo Go or in any build made before the prebuild that adds the
 *    module. `import()` inside a try/catch turns that into `null`, which the
 *    availability gate reads as "no passkeys here" and the UI hides the button.
 *
 * 2. Ceremony payloads go over the wire VERBATIM (`raw: true`): the client's
 *    null -> "\b" sentinel rewrite would corrupt a WebAuthn credential and the
 *    server reads it with `params.require(:credential).to_unsafe_h`, with no
 *    sentinel decoding on the far side.
 *
 * Errors are split on purpose. Anything the platform raises, plus a payload
 * that will not parse, becomes a PasskeyCeremonyError carrying a classified
 * kind; anything the HTTP layer raises stays an ApiError so the screens keep
 * their 401 / 429 branches (the /webauthn_credentials/authentication* pair
 * shares one 20/min per-IP bucket, so 429 is a normal outcome, not a bug).
 */
import { useEffect, useState } from "react";
import { request } from "@/api/client";
import type { Session } from "@/domain/user";
import {
  normalizeAssertionCredential,
  normalizeAssertionRequest,
  normalizeRegistrationCredential,
  normalizeRegistrationRequest,
} from "./passkeyEncoding";
import { classifyPasskeyError, PasskeyCeremonyError } from "./passkeyErrors";

/** GET /webauthn_credentials row (WebauthnCredentialBlueprint, :extended). */
export interface PasskeySummary {
  id: string;
  created_at: string;
  updated_at: string;
  nickname: string | null;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// Native module (lazy, never throws)
// ---------------------------------------------------------------------------

interface PasskeyModule {
  isSupported: () => boolean;
  create: (request: unknown) => Promise<unknown>;
  get: (request: unknown) => Promise<unknown>;
}

let modulePromise: Promise<PasskeyModule | null> | null = null;

const loadPasskeyModule = (): Promise<PasskeyModule | null> => {
  modulePromise ??= (async () => {
    try {
      const loaded = (await import("react-native-passkeys")) as unknown as Partial<PasskeyModule>;
      if (
        typeof loaded?.isSupported === "function" &&
        typeof loaded.create === "function" &&
        typeof loaded.get === "function"
      ) {
        return loaded as PasskeyModule;
      }
      return null;
    } catch {
      // Not linked (Expo Go, a stale dev client): treat as "no passkeys".
      return null;
    }
  })();
  return modulePromise;
};

let availabilityPromise: Promise<boolean> | null = null;

/**
 * True when the module is linked AND the OS is new enough (iOS 15+, Android
 * API 28+). It deliberately does NOT promise a usable authenticator: a
 * simulator with no enrolled biometrics answers true here and then fails the
 * ceremony with `noAuthenticator`, which is a message, not a crash.
 */
export const passkeysAvailable = (): Promise<boolean> => {
  availabilityPromise ??= (async () => {
    const module = await loadPasskeyModule();
    if (!module) return false;
    try {
      return module.isSupported() === true;
    } catch {
      return false;
    }
  })();
  return availabilityPromise;
};

/** Availability gate for the UI. `null` while the one-shot probe runs. */
export const usePasskeysAvailable = (): boolean | null => {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void passkeysAvailable().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return available;
};

const requirePasskeyModule = async (): Promise<PasskeyModule> => {
  const module = await loadPasskeyModule();
  if (!module) throw new PasskeyCeremonyError("unavailable");
  return module;
};

/**
 * Runs one platform ceremony. A rejection is classified; a `null` resolution
 * is the library's "no credential was produced", which only happens when the
 * sheet was dismissed.
 */
const runCeremony = async (call: () => Promise<unknown>): Promise<unknown> => {
  let result: unknown;
  try {
    result = await call();
  } catch (error) {
    throw new PasskeyCeremonyError(classifyPasskeyError(error), error);
  }
  if (result === null || result === undefined) throw new PasskeyCeremonyError("cancelled");
  return result;
};

/** Payload parsing failures are ceremony failures, not HTTP failures. */
const parse = <T>(read: () => T): T => {
  try {
    return read();
  } catch (error) {
    throw new PasskeyCeremonyError("failed", error);
  }
};

// ---------------------------------------------------------------------------
// The four endpoints
// ---------------------------------------------------------------------------

/** Public. Shares the 20/min per-IP bucket with the assertion below. */
export const fetchAuthenticationOptions = (): Promise<{ handle: string; options: unknown }> =>
  request("POST", "/webauthn_credentials/authentication_options", {
    body: {},
    raw: true,
    auth: false,
  });

/** Public. 201 with the full session :token view, same shape as POST /sessions. */
export const submitAuthentication = (credential: unknown, handle: string): Promise<Session> =>
  request("POST", "/webauthn_credentials/authentication", {
    body: { credential, handle },
    raw: true,
    auth: false,
  });

/** Authenticated. Lazily assigns users.webauthn_id on first use. */
export const fetchRegistrationOptions = (): Promise<unknown> =>
  request("POST", "/webauthn_credentials/registration_options", { body: {}, raw: true });

export const submitRegistration = (
  credential: unknown,
  nickname?: string,
): Promise<PasskeySummary> =>
  request("POST", "/webauthn_credentials/registration", {
    body: nickname ? { credential, nickname } : { credential },
    raw: true,
  });

export const listPasskeys = (): Promise<PasskeySummary[]> =>
  request("GET", "/webauthn_credentials");

export const deletePasskey = (id: string): Promise<void> =>
  request("DELETE", `/webauthn_credentials/${encodeURIComponent(id)}`);

// ---------------------------------------------------------------------------
// Ceremonies
// ---------------------------------------------------------------------------

/**
 * Discoverable-credential login: no email, no allowCredentials. The `handle`
 * is the single-use key the server cached the challenge under; it is only
 * valid for 2 minutes and is deleted before verification.
 */
export const assertPasskey = async (): Promise<Session> => {
  const module = await requirePasskeyModule();
  const { handle, options } = await fetchAuthenticationOptions();
  const assertionRequest = parse(() => normalizeAssertionRequest(options));
  const assertion = await runCeremony(() => module.get(assertionRequest));
  const credential = parse(() => normalizeAssertionCredential(assertion));
  return submitAuthentication(credential, handle);
};

/** Registers a passkey for the signed-in user. `nickname` is optional. */
export const createPasskey = async (nickname?: string): Promise<PasskeySummary> => {
  const module = await requirePasskeyModule();
  const options = await fetchRegistrationOptions();
  const creationRequest = parse(() => normalizeRegistrationRequest(options));
  const created = await runCeremony(() => module.create(creationRequest));
  const credential = parse(() => normalizeRegistrationCredential(created));
  const trimmed = nickname?.trim();
  return submitRegistration(credential, trimmed ? trimmed : undefined);
};
