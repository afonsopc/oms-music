/**
 * OAuth ticket flow (FR-12). The backend's callback redirect is hardcoded to
 * https://omelhorsite.pt/account/oauth/callback?ticket=...|?error=<code>; a
 * WebView (WP2) renders /auth/<provider>?mode=signin and intercepts that URL
 * with parseOAuthCallback, then hands the ticket to
 * `auth/session.ts#adoptOAuthTicket`, which runs the one shared
 * session-establishment path. Spotify account LINKING reuses the WebView
 * against /auth/link/spotify?token=<session token>.
 *
 * The URL parsing and the error-code map are pure and live
 * in ./oauthCallback so they can be unit tested; they are re-exported here so
 * callers keep importing "@/auth/oauth".
 *
 * Sign-in is id.omelhorsite.pt only (provider `zitadel`, id.omelhorsite.pt): the
 * email/password, signup, reset and passkey endpoints are gone from the
 * backend, and passkeys and email codes now live on id.omelhorsite.pt.
 */
import { Platform } from "react-native";
import { API_BASE_URL, oms, omsPublic } from "@/api/oms";
import { OAUTH_NATIVE_CALLBACK } from "./oauthCallback";
import type { OAuthMode, OAuthProvider } from "./oauthCallback";
import { getToken } from "./token";

export {
  isOAuthCallbackUrl,
  oauthErrorKey,
  parseOAuthCallback,
  OAUTH_CALLBACK_PREFIX,
  OAUTH_ERROR_KEYS,
  OAUTH_NATIVE_CALLBACK,
} from "./oauthCallback";
export type {
  OAuthCallbackResult,
  OAuthErrorCode,
  OAuthMode,
  OAuthProvider,
} from "./oauthCallback";

/**
 * The return-target flag rides the OmniAuth round trip:
 *  - native: `native=1` makes the backend answer on `omsmusic://oauth/callback`
 *    (OAUTH_NATIVE_CALLBACK), which closes the system-browser session;
 *  - web: `app_origin=<origin>` makes it answer on `<origin>/oauth/callback`,
 *    the app's own route, where maybeCompleteAuthSession() hands the popup's
 *    URL back to the opener. The backend only honours loopback origins and
 *    the exact production origin `https://music.omelhorsite.pt`
 *    (identities_controller.rb WEB_APP_ORIGINS - the return redirect carries
 *    a login ticket, so it is an allowlist, never a free param); any other
 *    origin falls back to the apex site's callback.
 */
export const buildOAuthUrl = (_provider: OAuthProvider, _mode: OAuthMode): string => {
  // O login é da própria app de música (cliente "OMS Music" no id), em
  // /music/auth/start; o regresso (?ticket= / ?error=) tem a mesma forma.
  if (Platform.OS === "web") {
    const origin = encodeURIComponent(window.location.origin);
    return `${API_BASE_URL}/music/auth/start?app_origin=${origin}`;
  }
  return `${API_BASE_URL}/music/auth/start?native=1`;
};

/**
 * O mesmo início no desktop (Tauri), sem `app_origin`: é o shell que o junta,
 * com o endereço local onde espera o regresso (src/desktop/tauri.ts).
 */
export const desktopLoginStartUrl = (): string => `${API_BASE_URL}/music/auth/start`;

/** Ligar o Spotify no desktop: o token vai no URL, como no nativo. */
export const desktopLinkStartUrl = (provider: OAuthProvider): string =>
  `${API_BASE_URL}/auth/link/${provider}?token=${encodeURIComponent(getToken() ?? "")}`;

/** Where the provider round trip must land for THIS platform. */
export const oauthReturnUrl = (): string =>
  Platform.OS === "web" ? `${window.location.origin}/oauth/callback` : OAUTH_NATIVE_CALLBACK;

/**
 * Ligar o Spotify (é da app de música: /auth/link/spotify). No nativo vai o
 * token da sessão no URL (o WebView não tem outra forma de o levar) e o
 * regresso é o callback https que o WebView intercepta; na web vai o cookie
 * (o separador novo é do mesmo site) e o regresso é a própria app.
 */
export const buildLinkUrl = (provider: OAuthProvider): string => {
  if (Platform.OS === "web") {
    const origin = encodeURIComponent(window.location.origin);
    return `${API_BASE_URL}/auth/link/${provider}?app_origin=${origin}`;
  }
  const token = getToken();
  return `${API_BASE_URL}/auth/link/${provider}?token=${encodeURIComponent(token ?? "")}`;
};

/**
 * POST /music/auth/adopt { ticket } -> { token, session }. O bilhete é
 * cifrado, vale 2 minutos, e repetido dentro do prazo devolve o mesmo token.
 * Na web a resposta deixa o cookie httpOnly da sessão da música.
 */
export const adoptTicket = async (ticket: string): Promise<string> => {
  const response = await omsPublic().http.post<{ token?: string }>("/music/auth/adopt", { ticket });
  if (!response?.token) throw new Error("Adopt response missing token");
  return response.token;
};

/**
 * POST /music/auth/exchange: a sessão antiga do omelhorsite (a que o
 * cliente já tem) passa a uma da música, sem login, com o mesmo id.
 */
export const exchangeLegacySession = async (): Promise<string | null> => {
  const response = await oms().http.post<{ token?: string | null }>("/music/auth/exchange");
  return response?.token ?? null;
};

/** A ligação ao Spotify (GET/DELETE /music/spotify). */
export interface SpotifyLinkStatus {
  allowed: boolean;
  connected: boolean;
  link: { id: string; name: string | null; email: string | null } | null;
}

export const getSpotifyLink = (): Promise<SpotifyLinkStatus> =>
  oms().http.get<SpotifyLinkStatus>("/music/spotify");

export const unlinkSpotify = (): Promise<void> => oms().http.delete<void>("/music/spotify");
