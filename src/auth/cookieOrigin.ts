/**
 * The suffix rule that picks the session mechanism on web (plano F2 / 2.2,
 * the same rule the site's BackendService.isCookieAuth implements): a page
 * served from the API's own site - omelhorsite.pt or any subdomain of it,
 * e.g. music.omelhorsite.pt - is SAME-SITE with backend.omelhorsite.pt, so
 * the SameSite=Lax httpOnly session cookie rides along on credentialed
 * requests and no Bearer token is needed (or wanted: the API reads the
 * header/param before the cookie, so a stale stored token next to a fresh
 * cookie 401s everything - the lockout the site's purgeLegacyToken cleans).
 *
 * Everything else keeps the Bearer token: native, the Tauri shell
 * (tauri://localhost), the Expo dev server (localhost), and pages.dev
 * staging - pages.dev is a public suffix, so a page there is a DIFFERENT
 * site and the browser will never send it the cookie, no CORS header can
 * change that.
 *
 * Pure on purpose so bun test can load it without react-native; the
 * platform-aware wrapper is ./authMode.ts#isCookieAuth.
 */

/** The registrable domain the API lives under. */
export const API_SITE = "omelhorsite.pt";

/** True when `hostname` is the API site itself or any subdomain of it. */
export const isCookieOrigin = (hostname: string | null | undefined): boolean =>
  hostname === API_SITE || (hostname ?? "").endsWith(`.${API_SITE}`);
