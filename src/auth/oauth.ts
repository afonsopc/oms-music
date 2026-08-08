/**
 * OAuth ticket flow (FR-12). The backend's callback redirect is hardcoded to
 * https://omelhorsite.pt/account/oauth/callback?ticket=...|?error=<code>; a
 * WebView (WP2) renders /auth/<provider>?mode=signin and intercepts that URL
 * with parseOAuthCallback, then hands the ticket to
 * `auth/session.ts#adoptOAuthTicket`, which runs the one shared
 * session-establishment path. Spotify account LINKING reuses the WebView
 * against /auth/link/spotify?token=<session token>.
 *
 * The URL parsing, the provider list and the error-code map are pure and live
 * in ./oauthCallback so they can be unit tested; they are re-exported here so
 * callers keep importing "@/auth/oauth".
 *
 * Passkeys (FR-13) used to keep a dead stub here; they now live in
 * ./passkeys, wired to the platform authenticator and to all four
 * /webauthn_credentials endpoints.
 */
import { Platform } from "react-native";
import { API_BASE_URL, request } from "@/api/client";
import { OAUTH_NATIVE_CALLBACK } from "./oauthCallback";
import type { OAuthMode, OAuthProvider } from "./oauthCallback";
import { getToken } from "./token";

export {
  isOAuthCallbackUrl,
  oauthErrorKey,
  oauthProvidersFor,
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
 *    URL back to the opener (backend only honours LOOPBACK origins).
 */
export const buildOAuthUrl = (provider: OAuthProvider, mode: OAuthMode): string => {
  if (Platform.OS === "web") {
    const origin = encodeURIComponent(window.location.origin);
    return `${API_BASE_URL}/auth/${provider}?mode=${mode}&app_origin=${origin}`;
  }
  return `${API_BASE_URL}/auth/${provider}?mode=${mode}&native=1`;
};

/** Where the provider round trip must land for THIS platform. */
export const oauthReturnUrl = (): string =>
  Platform.OS === "web" ? `${window.location.origin}/oauth/callback` : OAUTH_NATIVE_CALLBACK;

/**
 * Spotify linking while signed in passes the raw session token: the web mints
 * a 2 minute ticket instead because a host-only cookie cannot cross to the API
 * host, but a native client already holds the token
 * (`identities_controller.rb:5-14` accepts either).
 */
export const buildLinkUrl = (provider: OAuthProvider): string => {
  const token = getToken();
  return `${API_BASE_URL}/auth/link/${provider}?token=${encodeURIComponent(token ?? "")}`;
};

/**
 * POST /sessions/adopt { ticket } -> { token } and NOTHING else: no user, no
 * session metadata (`sessions_controller.rb:45-52`). The ticket is a signed id
 * with a 2 minute TTL, and adopt resolves it back to the session the callback
 * already minted rather than creating a new one, so replay inside the window
 * returns the same token.
 *
 * Returns the token instead of storing it: token storage, cache reset, cable
 * reconnection and navigation all belong to `session.ts#establishSession`, so
 * every sign-in method lands identically.
 */
export const adoptTicket = async (ticket: string): Promise<string> => {
  const response = await request<{ token: string }>("POST", "/sessions/adopt", {
    body: { ticket },
    auth: false,
  });
  if (!response?.token) throw new Error("Adopt response missing token");
  return response.token;
};

/** GET /identities (linked identity management). */
export interface Identity {
  id: string;
  provider: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export const listIdentities = (): Promise<Identity[]> => request("GET", "/identities");

export const deleteIdentity = (id: string): Promise<void> =>
  request("DELETE", `/identities/${encodeURIComponent(id)}`);
