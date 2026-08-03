/**
 * WebAuthn payload normalisation (FR-13). Pure module, no native imports, so
 * every branch below is bun-testable.
 *
 * Who encodes what, verified on disk rather than assumed:
 *
 *  - The backend serialises with `encoding = :base64url`
 *    (backend/config/initializers/webauthn.rb:25) and its encoder strips
 *    padding (webauthn-3.4.3 lib/webauthn/encoders.rb, Base64UrlEncoder#encode).
 *  - react-native-passkeys takes base64url STRINGS in and hands base64url
 *    strings back; it does the buffer conversion natively. iOS re-pads before
 *    decoding (ios/Shared.swift `Data(base64URLEncoded:)`) and strips padding
 *    on the way out; Android hands the JSON straight to Credential Manager,
 *    which is strict about the base64url alphabet.
 *
 * So no ArrayBuffer conversion is needed anywhere. What IS needed is a single
 * canonical form, because the two ends are not equally forgiving and one
 * server check is byte-exact: `PublicKeyCredential#valid_id?` decodes BOTH
 * `id` and `rawId` and demands the same bytes
 * (webauthn-3.4.3 lib/webauthn/public_key_credential.rb:71). A platform that
 * pads one and not the other would 401 with no useful message. Everything
 * therefore passes through `toBase64Url`, which accepts standard base64,
 * base64url, padded or not, and always emits unpadded base64url.
 *
 * The normalisers also rebuild the payloads field by field instead of
 * forwarding them whole: the `extensions: {}` the server sends is dropped
 * (nothing here uses extensions and an empty record is one more thing for a
 * native Record decoder to trip on), and `getPublicKey`/`publicKey` are
 * dropped from the registration response because the gem reads only
 * clientDataJSON + attestationObject + transports
 * (lib/webauthn/authenticator_attestation_response.rb:20-28).
 */
import { PasskeyDataError } from "./passkeyErrors";

const BASE64_ANY = /^[A-Za-z0-9+/_-]+$/;
const BASE64URL_ONLY = /^[A-Za-z0-9_-]+$/;

/**
 * Canonical unpadded base64url. Throws PasskeyDataError rather than silently
 * producing garbage, and never puts the value itself in the message.
 */
export const toBase64Url = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new PasskeyDataError(`${field}: not a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new PasskeyDataError(`${field}: empty`);
  const unpadded = trimmed.replace(/=+$/, "");
  if (!BASE64_ANY.test(unpadded)) throw new PasskeyDataError(`${field}: not base64`);
  const url = unpadded.replace(/\+/g, "-").replace(/\//g, "_");
  // No base64 string is 1 mod 4 long: that is a truncated value, not padding.
  if (url.length % 4 === 1) throw new PasskeyDataError(`${field}: truncated base64`);
  return url;
};

/** Non-throwing predicate for already-canonical values. */
export const isBase64Url = (value: unknown): value is string =>
  typeof value === "string" && BASE64URL_ONLY.test(value) && value.length % 4 !== 1;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export type PasskeyUserVerification = "required" | "preferred" | "discouraged";

export interface PasskeyDescriptor {
  type: "public-key";
  id: string;
  transports?: string[];
}

/** What react-native-passkeys `get()` wants. */
export interface PasskeyAssertionRequest {
  challenge: string;
  rpId: string;
  timeout?: number;
  allowCredentials?: PasskeyDescriptor[];
  userVerification?: PasskeyUserVerification;
}

/** What react-native-passkeys `create()` wants. */
export interface PasskeyRegistrationRequest {
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: PasskeyDescriptor[];
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: PasskeyUserVerification;
  };
  attestation?: string;
}

/** What POST /webauthn_credentials/authentication wants as `credential`. */
export interface PasskeyAssertionCredential {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

/** What POST /webauthn_credentials/registration wants as `credential`. */
export interface PasskeyRegistrationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PasskeyDataError(`${field}: not an object`);
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value) throw new PasskeyDataError(`${field}: not a string`);
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const optionalUserVerification = (value: unknown): PasskeyUserVerification | undefined =>
  value === "required" || value === "preferred" || value === "discouraged" ? value : undefined;

const plainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is string => typeof entry === "string" && !!entry);
  return list.length ? list : undefined;
};

/**
 * Empty lists come back as `undefined`, not `[]`: the login ceremony is
 * discoverable so the server always sends `allowCredentials: []`, and Rails'
 * deep_munge would rewrite an empty array to nil on the way back anyway.
 */
const normalizeDescriptors = (value: unknown, field: string): PasskeyDescriptor[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: PasskeyDescriptor[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const source = entry as Record<string, unknown>;
    const id = toBase64Url(source.id, `${field}[${index}].id`);
    const transports = stringList(source.transports);
    out.push(transports ? { type: "public-key", id, transports } : { type: "public-key", id });
  });
  return out.length ? out : undefined;
};

// ---------------------------------------------------------------------------
// Options: server -> platform
// ---------------------------------------------------------------------------

/** `options` from POST /webauthn_credentials/authentication_options. */
export const normalizeAssertionRequest = (raw: unknown): PasskeyAssertionRequest => {
  const source = asRecord(raw, "options");
  const timeout = optionalNumber(source.timeout);
  const allowCredentials = normalizeDescriptors(source.allowCredentials, "options.allowCredentials");
  const userVerification = optionalUserVerification(source.userVerification);
  return {
    challenge: toBase64Url(source.challenge, "options.challenge"),
    rpId: asString(source.rpId, "options.rpId"),
    ...(timeout === undefined ? {} : { timeout }),
    ...(allowCredentials ? { allowCredentials } : {}),
    ...(userVerification ? { userVerification } : {}),
  };
};

/** The body of POST /webauthn_credentials/registration_options. */
export const normalizeRegistrationRequest = (raw: unknown): PasskeyRegistrationRequest => {
  const source = asRecord(raw, "options");
  const rp = asRecord(source.rp, "options.rp");
  const user = asRecord(source.user, "options.user");

  if (!Array.isArray(source.pubKeyCredParams)) {
    throw new PasskeyDataError("options.pubKeyCredParams: not an array");
  }
  const pubKeyCredParams = source.pubKeyCredParams
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({ type: "public-key" as const, alg: optionalNumber(entry.alg) }))
    .filter((entry): entry is { type: "public-key"; alg: number } => entry.alg !== undefined);
  if (!pubKeyCredParams.length) {
    throw new PasskeyDataError("options.pubKeyCredParams: empty");
  }

  const rpId = optionalString(rp.id);
  const timeout = optionalNumber(source.timeout);
  const excludeCredentials = normalizeDescriptors(
    source.excludeCredentials,
    "options.excludeCredentials",
  );
  const attestation = optionalString(source.attestation);

  const selectionSource =
    source.authenticatorSelection && typeof source.authenticatorSelection === "object"
      ? (source.authenticatorSelection as Record<string, unknown>)
      : undefined;
  const authenticatorSelection = selectionSource
    ? {
        ...(optionalString(selectionSource.authenticatorAttachment)
          ? { authenticatorAttachment: optionalString(selectionSource.authenticatorAttachment) }
          : {}),
        ...(optionalString(selectionSource.residentKey)
          ? { residentKey: optionalString(selectionSource.residentKey) }
          : {}),
        ...(optionalBoolean(selectionSource.requireResidentKey) === undefined
          ? {}
          : { requireResidentKey: optionalBoolean(selectionSource.requireResidentKey) }),
        ...(optionalUserVerification(selectionSource.userVerification)
          ? { userVerification: optionalUserVerification(selectionSource.userVerification) }
          : {}),
      }
    : undefined;

  return {
    rp: { name: asString(rp.name, "options.rp.name"), ...(rpId ? { id: rpId } : {}) },
    user: {
      id: toBase64Url(user.id, "options.user.id"),
      name: asString(user.name, "options.user.name"),
      displayName: asString(user.displayName, "options.user.displayName"),
    },
    challenge: toBase64Url(source.challenge, "options.challenge"),
    pubKeyCredParams,
    ...(timeout === undefined ? {} : { timeout }),
    ...(excludeCredentials ? { excludeCredentials } : {}),
    ...(authenticatorSelection ? { authenticatorSelection } : {}),
    ...(attestation ? { attestation } : {}),
  };
};

// ---------------------------------------------------------------------------
// Credentials: platform -> server
// ---------------------------------------------------------------------------

/**
 * Android's Kotlin record declares `rawId: String? = null`, so fall back to
 * `id`: they are the same value by definition and the server compares their
 * decoded bytes.
 */
const resolveRawId = (source: Record<string, unknown>, id: string): string =>
  source.rawId === undefined || source.rawId === null
    ? id
    : toBase64Url(source.rawId, "credential.rawId");

export const normalizeAssertionCredential = (raw: unknown): PasskeyAssertionCredential => {
  const source = asRecord(raw, "credential");
  const response = asRecord(source.response, "credential.response");
  const id = toBase64Url(source.id, "credential.id");
  const userHandle =
    response.userHandle === undefined || response.userHandle === null || response.userHandle === ""
      ? undefined
      : toBase64Url(response.userHandle, "credential.response.userHandle");
  const attachment = optionalString(source.authenticatorAttachment);

  return {
    id,
    rawId: resolveRawId(source, id),
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON, "credential.response.clientDataJSON"),
      authenticatorData: toBase64Url(
        response.authenticatorData,
        "credential.response.authenticatorData",
      ),
      signature: toBase64Url(response.signature, "credential.response.signature"),
      ...(userHandle ? { userHandle } : {}),
    },
    ...(attachment ? { authenticatorAttachment: attachment } : {}),
    clientExtensionResults: plainObject(source.clientExtensionResults),
  };
};

export const normalizeRegistrationCredential = (raw: unknown): PasskeyRegistrationCredential => {
  const source = asRecord(raw, "credential");
  const response = asRecord(source.response, "credential.response");
  const id = toBase64Url(source.id, "credential.id");
  const transports = stringList(response.transports);
  const attachment = optionalString(source.authenticatorAttachment);

  return {
    id,
    rawId: resolveRawId(source, id),
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON, "credential.response.clientDataJSON"),
      attestationObject: toBase64Url(
        response.attestationObject,
        "credential.response.attestationObject",
      ),
      ...(transports ? { transports } : {}),
    },
    ...(attachment ? { authenticatorAttachment: attachment } : {}),
    clientExtensionResults: plainObject(source.clientExtensionResults),
  };
};
