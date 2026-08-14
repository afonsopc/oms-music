import { describe, expect, it } from "bun:test";
import { API_SITE, isCookieOrigin } from "../cookieOrigin";

// The rule decides whether the app authenticates with the httpOnly cookie
// (same-site with backend.omelhorsite.pt) or a Bearer token. A wrong `true`
// silently drops the Authorization header and every request 401s; a wrong
// `false` stores tokens on the production origin. Both directions are pinned.
describe("isCookieOrigin", () => {
  it("pins the API site the rule is anchored to", () => {
    expect(API_SITE).toBe("omelhorsite.pt");
  });

  it("accepts the apex and every subdomain of the API site", () => {
    expect(isCookieOrigin("omelhorsite.pt")).toBe(true);
    expect(isCookieOrigin("music.omelhorsite.pt")).toBe(true);
    expect(isCookieOrigin("www.omelhorsite.pt")).toBe(true);
    // The API host itself, should a page ever be served from it.
    expect(isCookieOrigin("backend.omelhorsite.pt")).toBe(true);
  });

  it("rejects every Bearer-token host", () => {
    // Dev server and loopback.
    expect(isCookieOrigin("localhost")).toBe(false);
    expect(isCookieOrigin("127.0.0.1")).toBe(false);
    // pages.dev staging: a public suffix, therefore a DIFFERENT site whose
    // requests the browser will never attach our cookie to.
    expect(isCookieOrigin("staging.oms-62n.pages.dev")).toBe(false);
    // Registrable-suffix lookalikes must not pass a suffix rule.
    expect(isCookieOrigin("omelhorsite.pt.evil.example")).toBe(false);
    expect(isCookieOrigin("evilomelhorsite.pt")).toBe(false);
    // Tauri shell serves from its own scheme/host, not the API site.
    expect(isCookieOrigin("tauri.localhost")).toBe(false);
  });

  it("treats a missing hostname as not cookie-auth", () => {
    expect(isCookieOrigin(null)).toBe(false);
    expect(isCookieOrigin(undefined)).toBe(false);
    expect(isCookieOrigin("")).toBe(false);
  });
});
