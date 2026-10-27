/**
 * The OAuth return URL, parsed. Pure and dependency-free so it is unit tested
 * without a device; `auth/oauth.ts` re-exports everything here.
 *
 * The backend's return target is HARDCODED and not parameterisable:
 * `IdentitiesController#redirect_with_token` builds
 * `#{Rails.configuration.frontend_url}/account/oauth/callback` and appends
 * `?ticket=` (the normal outcome), `?token=` (legacy, see below) or
 * `?error=<code>` (`identities_controller.rb:203-218`, `:238-240`), with
 * `frontend_url == "https://omelhorsite.pt"` in production
 * (`config/initializers/00_urls.rb:3`). There is no custom scheme to redirect
 * to, which is why the native flow renders the provider round trip in a
 * WebView and intercepts this URL instead.
 *
 * Two things make a bare `startsWith` prefix test too fragile:
 *
 *  1. the apex is a static export whose host rewrites the locale-less path:
 *     `frontend/public/_redirects:32` sends
 *     `/account/oauth/callback` -> `/en/account/oauth/callback/` with a 302,
 *     query string preserved. iOS usually fires
 *     `onShouldStartLoadWithRequest` on the pre-redirect URL, but Android
 *     frequently only reports the FINAL url through `onNavigationStateChange`,
 *     i.e. the locale-prefixed, trailing-slashed one. Missing it would leave
 *     the user staring at the website inside the sign-in sheet;
 *  2. `www.omelhorsite.pt` 301s to the apex, so a redirect chain can surface
 *     either host.
 *
 * So the match is done on host + normalised path, not on a literal prefix.
 */

/** Kept for callers that only need the canonical target. */
export const OAUTH_CALLBACK_PREFIX = "https://omelhorsite.pt/account/oauth/callback";

/**
 * The backend's native return target (IdentitiesController::NATIVE_CALLBACK):
 * when the flow starts with `?native=1`, the callback redirects HERE instead
 * of the website, which is what lets ASWebAuthenticationSession / Custom Tabs
 * close themselves and hand the ticket to the app.
 */
export const OAUTH_NATIVE_CALLBACK = "omsmusic://oauth/callback";

const CALLBACK_HOSTS = new Set(["omelhorsite.pt", "www.omelhorsite.pt"]);
const CALLBACK_PATH = "account/oauth/callback";
/** The three locales the static export prefixes paths with. */
const LOCALE_SEGMENTS = new Set(["en", "pt", "lv"]);

export type OAuthProvider = "google_oauth2" | "github" | "spotify";
export type OAuthMode = "signin" | "signup" | "link";

/**
 * Every code `IdentitiesController` can put in `?error=`, plus the two the
 * client raises for itself. Server side:
 * `account_exists`, `account_not_found`, `unauthorized`, `conflict`,
 * `internal` (`identities_controller.rb:71-111`) and
 * `spotify_not_allowlisted` (`:30`, `:130`).
 */
export type OAuthErrorCode =
  | "account_exists"
  | "account_not_found"
  | "unauthorized"
  | "conflict"
  | "internal"
  | "spotify_not_allowlisted"
  | "oauth_state"
  | "oauth_failed";

/** i18n keys for the error codes; screens resolve them through t(). */
export const OAUTH_ERROR_KEYS: Record<OAuthErrorCode, string> = {
  account_exists: "native.auth.oauthErrors.accountExists",
  account_not_found: "native.auth.oauthErrors.accountNotFound",
  unauthorized: "native.auth.oauthErrors.unauthorized",
  conflict: "native.auth.oauthErrors.conflict",
  internal: "native.auth.oauthErrors.internal",
  spotify_not_allowlisted: "native.auth.oauthErrors.spotifyNotAllowlisted",
  oauth_state: "native.auth.oauthErrors.oauthFailed",
  oauth_failed: "native.auth.oauthErrors.oauthFailed",
};

export const oauthErrorKey = (code: string): string =>
  OAUTH_ERROR_KEYS[code as OAuthErrorCode] ?? OAUTH_ERROR_KEYS.oauth_failed;

export type OAuthCallbackResult =
  /** The normal outcome: a 2 minute signed id for POST /sessions/adopt. */
  | { kind: "ticket"; ticket: string }
  /**
   * The legacy `?token=` branch (`identities_controller.rb:216`), which only
   * fires when `Current.session` is nil AND a `token` request param rode into
   * the OmniAuth request phase (`config/initializers/omniauth.rb:57-63`).
   * Unreachable from this app: the native link flow passes `token` to
   * `/auth/link/:provider`, a plain Rails action that never enters the request
   * phase, and it always creates a session before redirecting. It is parsed so
   * the "unknown shape" fallback stays honest, and refused rather than adopted
   * because storing a raw session token straight out of a URL is a session
   * fixation primitive the app has no need for.
   */
  | { kind: "token"; token: string }
  | { kind: "error"; error: OAuthErrorCode | string }
  | null;

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Query string -> map, with `+` meaning space as in form encoding. */
const parseQuery = (query: string): Map<string, string> => {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : "";
    params.set(decode(key), decode(value.replace(/\+/g, " ")));
  }
  return params;
};

/** True when `url` is the OAuth return target in any of its rendered forms. */
export const isOAuthCallbackUrl = (url: string): boolean => {
  const trimmed = url.trim();
  // The native scheme form the system-browser flow completes on.
  if (/^omsmusic:\/\/oauth\/callback\/?([?#]|$)/i.test(trimmed)) return true;
  // The web popup form: the app's OWN origin + /oauth/callback (the backend
  // only sends loopback origins here; client-side we just recognise the path).
  if (/^https?:\/\/[^/?#]+\/oauth\/callback\/?([?#]|$)/i.test(trimmed)) return true;
  const match = trimmed.match(/^https:\/\/([^/?#]+)([^?#]*)/i);
  if (!match) return false;
  const host = match[1].toLowerCase().replace(/:443$/, "");
  if (!CALLBACK_HOSTS.has(host)) return false;
  const segments = match[2].split("/").filter((segment) => segment.length > 0);
  if (segments.length > 0 && LOCALE_SEGMENTS.has(segments[0].toLowerCase())) segments.shift();
  return segments.join("/").toLowerCase() === CALLBACK_PATH;
};

/**
 * Pure URL inspection for `onShouldStartLoadWithRequest`: null when the URL is
 * not the callback (let the WebView load it), otherwise the outcome to act on.
 * A callback with none of the three known params is reported as
 * `oauth_failed` rather than swallowed.
 */
export const parseOAuthCallback = (url: string): OAuthCallbackResult => {
  if (!isOAuthCallbackUrl(url)) return null;
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  const end = hashStart >= 0 && hashStart > queryStart ? hashStart : url.length;
  const query = queryStart >= 0 ? url.slice(queryStart + 1, end) : "";
  const params = parseQuery(query);

  const ticket = params.get("ticket");
  if (ticket) return { kind: "ticket", ticket };
  const error = params.get("error");
  if (error) return { kind: "error", error };
  const token = params.get("token");
  if (token) return { kind: "token", token };
  return { kind: "error", error: "oauth_failed" };
};

/**
 * Which providers the app offers, per mode.
 *
 * Google is ON now that the flow runs in the system browser: the backend
 * answers `?native=1` flows on the omsmusic:// scheme
 * (IdentitiesController::NATIVE_CALLBACK), so ASWebAuthenticationSession /
 * Custom Tabs - which Google accepts, unlike embedded webviews
 * (`disallowed_useragent`) - can complete and hand the ticket back.
 *
 * Spotify is dropped from `signup` for the same reason the web drops it
 * (`frontend/components/account/authentication/OAuthButtons.tsx:34-39`): the
 * Spotify app is in Dev Mode, so an account that is not on the dashboard
 * allowlist cannot complete the round trip at all.
 */
export const oauthProvidersFor = (mode: OAuthMode): OAuthProvider[] =>
  mode === "signup"
    ? ["google_oauth2", "github"]
    : ["google_oauth2", "github", "spotify"];
