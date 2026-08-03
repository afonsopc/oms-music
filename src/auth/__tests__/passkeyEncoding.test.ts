import { describe, expect, it } from "bun:test";
import {
  isBase64Url,
  normalizeAssertionCredential,
  normalizeAssertionRequest,
  normalizeRegistrationCredential,
  normalizeRegistrationRequest,
  toBase64Url,
} from "../passkeyEncoding";
import { PasskeyDataError } from "../passkeyErrors";

/** Shaped exactly like the body the Rails controller returns. */
const AUTH_OPTIONS = {
  challenge: "qFPCJ1gHhOKCVexQP2Q4TA",
  timeout: 120000,
  extensions: {},
  allowCredentials: [],
  rpId: "omelhorsite.pt",
  userVerification: "preferred",
};

const REGISTRATION_OPTIONS = {
  challenge: "qFPCJ1gHhOKCVexQP2Q4TA",
  timeout: 120000,
  extensions: {},
  rp: { name: "O Melhor Site", id: "omelhorsite.pt" },
  user: {
    name: "afonso@omelhorsite.pt",
    id: "dGVzdC11c2VyLWlkZW50aWZpZXI",
    displayName: "Afonso",
  },
  pubKeyCredParams: [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ],
  excludeCredentials: [{ type: "public-key", id: "ZXhpc3RpbmctY3JlZGVudGlhbA" }],
  authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
};

describe("toBase64Url", () => {
  it("passes canonical unpadded base64url through unchanged", () => {
    expect(toBase64Url("qFPCJ1gHhOKCVexQP2Q4TA", "f")).toBe("qFPCJ1gHhOKCVexQP2Q4TA");
  });

  it("strips padding, which Android's Credential Manager rejects", () => {
    expect(toBase64Url("YWJjZA==", "f")).toBe("YWJjZA");
    expect(toBase64Url("YWJjZGU=", "f")).toBe("YWJjZGU");
  });

  it("translates the standard base64 alphabet to the url-safe one", () => {
    expect(toBase64Url("a+b/c+d/", "f")).toBe("a-b_c-d_");
  });

  it("leaves an already url-safe string alone", () => {
    expect(toBase64Url("a-b_c-d_", "f")).toBe("a-b_c-d_");
  });

  it("trims surrounding whitespace", () => {
    expect(toBase64Url("  YWJjZA==\n", "f")).toBe("YWJjZA");
  });

  it("makes a padded and an unpadded form of the same value equal", () => {
    // The server decodes BOTH `id` and `rawId` and demands identical bytes
    // (webauthn public_key_credential.rb valid_id?), so canonicalising is what
    // keeps a platform that pads one of them from 401ing with no explanation.
    expect(toBase64Url("YWJjZA==", "id")).toBe(toBase64Url("YWJjZA", "rawId"));
  });

  it("rejects a non-string", () => {
    expect(() => toBase64Url(undefined, "f")).toThrow(PasskeyDataError);
    expect(() => toBase64Url(42, "f")).toThrow(PasskeyDataError);
    expect(() => toBase64Url(null, "f")).toThrow(PasskeyDataError);
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(() => toBase64Url("", "f")).toThrow(PasskeyDataError);
    expect(() => toBase64Url("   ", "f")).toThrow(PasskeyDataError);
  });

  it("rejects characters outside both alphabets", () => {
    expect(() => toBase64Url("abc!def", "f")).toThrow(PasskeyDataError);
    expect(() => toBase64Url("abc def", "f")).toThrow(PasskeyDataError);
  });

  it("rejects a length that no base64 string can have", () => {
    // 1 mod 4 is unreachable for valid base64: the value is truncated.
    expect(() => toBase64Url("abcde", "f")).toThrow(PasskeyDataError);
  });

  it("names the field but never leaks the value", () => {
    expect(() => toBase64Url("abc!", "options.challenge")).toThrow(/options\.challenge/);
    try {
      toBase64Url("s3cr3t!", "options.challenge");
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cr3t");
    }
  });
});

describe("isBase64Url", () => {
  it("accepts canonical values only", () => {
    expect(isBase64Url("a-b_c-d_")).toBe(true);
    expect(isBase64Url("YWJjZA")).toBe(true);
  });

  it("rejects padded, standard-alphabet, truncated and non-string values", () => {
    expect(isBase64Url("YWJjZA==")).toBe(false);
    expect(isBase64Url("a+b/c")).toBe(false);
    expect(isBase64Url("abcde")).toBe(false);
    expect(isBase64Url(undefined)).toBe(false);
  });
});

describe("normalizeAssertionRequest", () => {
  it("keeps what the authenticator needs", () => {
    expect(normalizeAssertionRequest(AUTH_OPTIONS)).toEqual({
      challenge: "qFPCJ1gHhOKCVexQP2Q4TA",
      rpId: "omelhorsite.pt",
      timeout: 120000,
      userVerification: "preferred",
    });
  });

  it("drops the empty allowCredentials of the discoverable flow", () => {
    expect(normalizeAssertionRequest(AUTH_OPTIONS).allowCredentials).toBeUndefined();
  });

  it("drops the server's empty extensions object", () => {
    expect("extensions" in normalizeAssertionRequest(AUTH_OPTIONS)).toBe(false);
  });

  it("canonicalises credential ids when the server does send some", () => {
    const options = {
      ...AUTH_OPTIONS,
      allowCredentials: [{ type: "public-key", id: "YWJjZA==", transports: ["internal"] }],
    };
    expect(normalizeAssertionRequest(options).allowCredentials).toEqual([
      { type: "public-key", id: "YWJjZA", transports: ["internal"] },
    ]);
  });

  it("drops an empty transports list", () => {
    const options = {
      ...AUTH_OPTIONS,
      allowCredentials: [{ type: "public-key", id: "YWJjZA", transports: [] }],
    };
    expect(normalizeAssertionRequest(options).allowCredentials).toEqual([
      { type: "public-key", id: "YWJjZA" },
    ]);
  });

  it("ignores an unknown userVerification value", () => {
    const options = { ...AUTH_OPTIONS, userVerification: "sometimes" };
    expect(normalizeAssertionRequest(options).userVerification).toBeUndefined();
  });

  it("refuses options without an rpId, which iOS requires", () => {
    const { rpId: _rpId, ...rest } = AUTH_OPTIONS;
    expect(() => normalizeAssertionRequest(rest)).toThrow(PasskeyDataError);
  });

  it("refuses a non-object payload", () => {
    expect(() => normalizeAssertionRequest(null)).toThrow(PasskeyDataError);
    expect(() => normalizeAssertionRequest("nope")).toThrow(PasskeyDataError);
    expect(() => normalizeAssertionRequest([])).toThrow(PasskeyDataError);
  });
});

describe("normalizeRegistrationRequest", () => {
  it("keeps the creation options the authenticator needs", () => {
    expect(normalizeRegistrationRequest(REGISTRATION_OPTIONS)).toEqual({
      rp: { name: "O Melhor Site", id: "omelhorsite.pt" },
      user: {
        id: "dGVzdC11c2VyLWlkZW50aWZpZXI",
        name: "afonso@omelhorsite.pt",
        displayName: "Afonso",
      },
      challenge: "qFPCJ1gHhOKCVexQP2Q4TA",
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 120000,
      excludeCredentials: [{ type: "public-key", id: "ZXhpc3RpbmctY3JlZGVudGlhbA" }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  });

  it("omits excludeCredentials when the user has no passkeys yet", () => {
    const options = { ...REGISTRATION_OPTIONS, excludeCredentials: [] };
    expect(normalizeRegistrationRequest(options).excludeCredentials).toBeUndefined();
  });

  it("refuses an empty pubKeyCredParams", () => {
    expect(() =>
      normalizeRegistrationRequest({ ...REGISTRATION_OPTIONS, pubKeyCredParams: [] }),
    ).toThrow(PasskeyDataError);
  });

  it("drops algorithm entries that carry no number", () => {
    const options = {
      ...REGISTRATION_OPTIONS,
      pubKeyCredParams: [{ type: "public-key" }, { type: "public-key", alg: -7 }],
    };
    expect(normalizeRegistrationRequest(options).pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
    ]);
  });

  it("refuses a user id that is not base64url", () => {
    const options = { ...REGISTRATION_OPTIONS, user: { ...REGISTRATION_OPTIONS.user, id: "!!" } };
    expect(() => normalizeRegistrationRequest(options)).toThrow(PasskeyDataError);
  });
});

describe("normalizeAssertionCredential", () => {
  const IOS_ASSERTION = {
    id: "Y3JlZGVudGlhbC1pZA",
    rawId: "Y3JlZGVudGlhbC1pZA",
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: "Y2xpZW50LWRhdGE",
      authenticatorData: "YXV0aC1kYXRh",
      signature: "c2lnbmF0dXJl",
      userHandle: "dXNlci1oYW5kbGU",
    },
  };

  it("keeps exactly what the gem reads", () => {
    expect(normalizeAssertionCredential(IOS_ASSERTION)).toEqual({
      id: "Y3JlZGVudGlhbC1pZA",
      rawId: "Y3JlZGVudGlhbC1pZA",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "Y2xpZW50LWRhdGE",
        authenticatorData: "YXV0aC1kYXRh",
        signature: "c2lnbmF0dXJl",
        userHandle: "dXNlci1oYW5kbGU",
      },
    });
  });

  it("falls back to id when Android leaves rawId null", () => {
    const credential = { ...IOS_ASSERTION, rawId: null };
    const normalized = normalizeAssertionCredential(credential);
    expect(normalized.rawId).toBe(normalized.id);
  });

  it("reconciles a padded rawId with an unpadded id", () => {
    const normalized = normalizeAssertionCredential({
      ...IOS_ASSERTION,
      id: "YWJjZA",
      rawId: "YWJjZA==",
    });
    expect(normalized.rawId).toBe(normalized.id);
  });

  it("omits an absent or empty userHandle rather than sending null", () => {
    const { userHandle: _userHandle, ...response } = IOS_ASSERTION.response;
    expect(
      "userHandle" in normalizeAssertionCredential({ ...IOS_ASSERTION, response }).response,
    ).toBe(false);
    expect(
      normalizeAssertionCredential({
        ...IOS_ASSERTION,
        response: { ...IOS_ASSERTION.response, userHandle: "" },
      }).response.userHandle,
    ).toBeUndefined();
  });

  it("defaults clientExtensionResults to an object", () => {
    const { clientExtensionResults: _drop, ...credential } = IOS_ASSERTION;
    expect(normalizeAssertionCredential(credential).clientExtensionResults).toEqual({});
  });

  it("refuses an assertion missing a signature", () => {
    const { signature: _signature, ...response } = IOS_ASSERTION.response;
    expect(() => normalizeAssertionCredential({ ...IOS_ASSERTION, response })).toThrow(
      PasskeyDataError,
    );
  });

  it("refuses a credential with no response", () => {
    expect(() => normalizeAssertionCredential({ id: "YWJjZA" })).toThrow(PasskeyDataError);
  });
});

describe("normalizeRegistrationCredential", () => {
  const CREATION = {
    id: "bmV3LWNyZWRlbnRpYWw",
    rawId: "bmV3LWNyZWRlbnRpYWw",
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      clientDataJSON: "Y2xpZW50LWRhdGE",
      attestationObject: "YXR0ZXN0YXRpb24",
      transports: ["internal", "hybrid"],
      publicKey: "cHVibGljLWtleQ",
      publicKeyAlgorithm: -7,
      authenticatorData: "YXV0aC1kYXRh",
    },
  };

  it("keeps only the fields the gem reads", () => {
    expect(normalizeRegistrationCredential(CREATION)).toEqual({
      id: "bmV3LWNyZWRlbnRpYWw",
      rawId: "bmV3LWNyZWRlbnRpYWw",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: "Y2xpZW50LWRhdGE",
        attestationObject: "YXR0ZXN0YXRpb24",
        transports: ["internal", "hybrid"],
      },
    });
  });

  it("drops publicKey, publicKeyAlgorithm and the getPublicKey function", () => {
    const withFunction = {
      ...CREATION,
      response: { ...CREATION.response, getPublicKey: () => "cHVibGljLWtleQ" },
    };
    const normalized = normalizeRegistrationCredential(withFunction);
    expect("getPublicKey" in normalized.response).toBe(false);
    expect("publicKey" in normalized.response).toBe(false);
    expect("publicKeyAlgorithm" in normalized.response).toBe(false);
  });

  it("drops an empty transports list, which Rails would nil out anyway", () => {
    const normalized = normalizeRegistrationCredential({
      ...CREATION,
      response: { ...CREATION.response, transports: [] },
    });
    expect(normalized.response.transports).toBeUndefined();
  });

  it("refuses a creation response with no attestationObject", () => {
    const { attestationObject: _drop, ...response } = CREATION.response;
    expect(() => normalizeRegistrationCredential({ ...CREATION, response })).toThrow(
      PasskeyDataError,
    );
  });

  it("survives a JSON round trip, which is what the client actually sends", () => {
    const normalized = normalizeRegistrationCredential(CREATION);
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
  });
});
