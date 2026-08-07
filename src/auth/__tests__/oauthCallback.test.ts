import { describe, expect, it } from "bun:test";
import {
  isOAuthCallbackUrl,
  oauthErrorKey,
  oauthProvidersFor,
  parseOAuthCallback,
  OAUTH_CALLBACK_PREFIX,
  OAUTH_ERROR_KEYS,
} from "../oauthCallback";

/** A realistic ActiveRecord signed id: base64url, `--` separated, no `+`. */
const TICKET =
  "eyJfcmFpbHMiOnsiZGF0YSI6IjAxOTgtYWJjIiwicHVyIjoib2F1dGgifX0=--9f1c3ab2d4e5f60718293a4b5c6d7e8f90a1b2c3";

describe("parseOAuthCallback", () => {
  it("ignores every URL that is not the callback", () => {
    expect(parseOAuthCallback("https://github.com/login/oauth/authorize")).toBeNull();
    expect(parseOAuthCallback("https://backend.omelhorsite.pt/auth/github?mode=signin")).toBeNull();
    expect(parseOAuthCallback("https://omelhorsite.pt/en/music")).toBeNull();
    expect(parseOAuthCallback("")).toBeNull();
    // Same path, foreign host: an attacker page must not look like the callback.
    expect(parseOAuthCallback("https://evil.example/account/oauth/callback?ticket=x")).toBeNull();
    // http is not the scheme the backend redirects to.
    expect(parseOAuthCallback("http://omelhorsite.pt/account/oauth/callback?ticket=x")).toBeNull();
  });

  it("extracts the ticket from the URL the backend actually redirects to", () => {
    const result = parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?ticket=${TICKET}`);
    expect(result).toEqual({ kind: "ticket", ticket: TICKET });
  });

  it("still matches after the apex rewrites the path", () => {
    // frontend/public/_redirects:32 turns /account/oauth/callback into
    // /en/account/oauth/callback/ with a 302, and Android frequently only
    // reports that final URL.
    for (const locale of ["en", "pt", "lv"]) {
      const url = `https://omelhorsite.pt/${locale}/account/oauth/callback/?ticket=${TICKET}`;
      expect(parseOAuthCallback(url)).toEqual({ kind: "ticket", ticket: TICKET });
    }
  });

  it("matches the www host and a trailing slash", () => {
    expect(
      parseOAuthCallback(`https://www.omelhorsite.pt/account/oauth/callback/?ticket=${TICKET}`),
    ).toEqual({ kind: "ticket", ticket: TICKET });
  });

  it("does not treat a deeper path as the callback", () => {
    expect(isOAuthCallbackUrl("https://omelhorsite.pt/account/oauth/callback/extra")).toBe(false);
    expect(isOAuthCallbackUrl("https://omelhorsite.pt/account/oauth")).toBe(false);
  });

  it("reports every error code the backend can redirect with", () => {
    for (const code of [
      "account_exists",
      "account_not_found",
      "unauthorized",
      "conflict",
      "internal",
      "spotify_not_allowlisted",
    ]) {
      expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?error=${code}`)).toEqual({
        kind: "error",
        error: code,
      });
    }
  });

  it("prefers a ticket over an error and an error over a legacy token", () => {
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?error=internal&ticket=${TICKET}`)).toEqual({
      kind: "ticket",
      ticket: TICKET,
    });
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?token=abc&error=internal`)).toEqual({
      kind: "error",
      error: "internal",
    });
  });

  it("surfaces the legacy ?token= branch as its own kind so it can be refused", () => {
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?token=5b1f-uuid`)).toEqual({
      kind: "token",
      token: "5b1f-uuid",
    });
  });

  it("never swallows a callback that carries nothing usable", () => {
    expect(parseOAuthCallback(OAUTH_CALLBACK_PREFIX)).toEqual({
      kind: "error",
      error: "oauth_failed",
    });
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?`)).toEqual({
      kind: "error",
      error: "oauth_failed",
    });
    // Empty values are not usable either.
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?ticket=&error=`)).toEqual({
      kind: "error",
      error: "oauth_failed",
    });
  });

  it("stops at the fragment and decodes percent escapes", () => {
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_PREFIX}?error=account%5Fexists#top`)).toEqual({
      kind: "error",
      error: "account_exists",
    });
  });
});

describe("oauthErrorKey", () => {
  it("has a catalog key for every known code", () => {
    for (const [code, key] of Object.entries(OAUTH_ERROR_KEYS)) {
      expect(oauthErrorKey(code)).toBe(key);
      expect(key.startsWith("native.auth.oauthErrors.")).toBe(true);
    }
  });

  it("falls back for a code the backend grows later", () => {
    expect(oauthErrorKey("brand_new_refusal")).toBe(OAUTH_ERROR_KEYS.oauth_failed);
  });
});

describe("oauthProvidersFor", () => {
  it("offers Google now that the flow runs in the system browser", () => {
    expect(oauthProvidersFor("signin")).toContain("google_oauth2");
    expect(oauthProvidersFor("signup")).toContain("google_oauth2");
  });

  it("drops Spotify from signup, where the Dev Mode allowlist blocks it", () => {
    expect(oauthProvidersFor("signup")).toEqual(["google_oauth2", "github"]);
    expect(oauthProvidersFor("signin")).toEqual(["google_oauth2", "github", "spotify"]);
  });
});

describe("native scheme callback (system-browser flow)", () => {
  it("recognizes the omsmusic:// return target", () => {
    expect(isOAuthCallbackUrl("omsmusic://oauth/callback?ticket=abc")).toBe(true);
    expect(isOAuthCallbackUrl("omsmusic://oauth/callback/?error=internal")).toBe(true);
    expect(isOAuthCallbackUrl("omsmusic://oauth/callback")).toBe(true);
    expect(isOAuthCallbackUrl("omsmusic://other/callback?ticket=abc")).toBe(false);
  });

  it("parses ticket and error from the scheme URL", () => {
    expect(parseOAuthCallback("omsmusic://oauth/callback?ticket=t123")).toEqual({
      kind: "ticket",
      ticket: "t123",
    });
    expect(parseOAuthCallback("omsmusic://oauth/callback?error=account_not_found")).toEqual({
      kind: "error",
      error: "account_not_found",
    });
  });
});
