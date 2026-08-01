/**
 * OAuth sign-in buttons (FR-12, P1). The flow needs react-native-webview to
 * render /auth/<provider>?mode=signin and intercept the hardcoded callback
 * URL (auth/oauth.ts has the whole ticket pipeline ready: buildOAuthUrl ->
 * parseOAuthCallback -> adoptTicket). Installing react-native-webview needs
 * explicit user approval, which has not been given, so per WORKPLAN WP2.3
 * the buttons stay HIDDEN. When the dependency lands: flip OAUTH_ENABLED,
 * render GitHub + Spotify buttons (Google only if the WebView is not refused
 * with disallowed_useragent - DESIGN 16.4) and drive the WebView flow here.
 */
export const OAUTH_ENABLED = false as boolean;

export default function OAuthButtons() {
  return null;
}
