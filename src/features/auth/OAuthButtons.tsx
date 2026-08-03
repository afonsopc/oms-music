/**
 * OAuth sign-in buttons (FR-12, P1). react-native-webview is installed, so
 * the WebView interception flow is live: the button opens
 * `/auth/<provider>?mode=<signin|signup>` in a modal WebView and the hardcoded
 * `https://omelhorsite.pt/account/oauth/callback` redirect is intercepted
 * (there is no custom-scheme redirect server-side and adding one would need a
 * backend change). The extracted ticket is exchanged through
 * `POST /sessions/adopt` within its 2 minute TTL, then handed to the shared
 * `establishSession` path so OAuth lands exactly like a password login.
 * Failures come back as `?error=<code>` and map to the catalog through
 * OAUTH_ERROR_KEYS; an adopt that arrives too late maps to a "took too long"
 * message rather than a generic one.
 *
 * Interception runs on BOTH `onShouldStartLoadWithRequest` and
 * `onNavigationStateChange`: Android does not reliably fire the former for a
 * server-side 302, and the backend callback IS a redirect. `parseOAuthCallback`
 * matches on host plus normalised path rather than a literal prefix, because
 * the apex rewrites `/account/oauth/callback` to
 * `/<locale>/account/oauth/callback/` and Android often reports only that final
 * URL.
 *
 * Which providers appear, and WHY Google does not, is decided by
 * `oauthProvidersFor` in auth/oauthCallback.ts - the reasoning is recorded
 * there because it is a contract fact, not a styling choice.
 *
 * The sheet only ever opens from a tap here, which is what stands in for the
 * web client's `oauth_pending` marker: a callback URL cannot be replayed into
 * the app because nothing else can navigate this WebView.
 *
 * The WebView runs `incognito`: the provider round trip needs its own cookie
 * jar, but nothing about it may persist (native auth is bearer-token only).
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { authErrorMessage, classifyAdoptError } from "@/auth/authErrors";
import {
  buildOAuthUrl,
  oauthErrorKey,
  oauthProvidersFor,
  OAUTH_ERROR_KEYS,
  parseOAuthCallback,
  type OAuthMode,
  type OAuthProvider,
} from "@/auth/oauth";
import { adoptOAuthTicket } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { AuthError } from "./ui";

export const OAUTH_ENABLED = true as boolean;

const PROVIDER_LABEL_KEYS: Record<OAuthProvider, string> = {
  google_oauth2: "native.auth.oauth.google",
  github: "native.auth.oauth.github",
  spotify: "native.auth.oauth.spotify",
};

const Divider = () => {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
      <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
        {t("native.auth.oauth.dividerOr")}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
    </View>
  );
};

const ProviderButton = ({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: tokens.secondary,
        borderColor: tokens.border,
        borderWidth: 1,
        opacity: disabled ? 0.55 : 1,
        borderRadius: 999,
        paddingVertical: 13,
        alignItems: "center",
        marginBottom: 10,
      }}
    >
      <Text style={{ color: tokens.secondaryForeground, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
};

export default function OAuthButtons({ mode = "signin" }: { mode?: OAuthMode }) {
  const t = useT();
  const { tokens } = useTheme();
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * One callback per opened sheet. It is a flag, not the URL: the same
   * outcome reaches us under two spellings (the pre-redirect
   * `/account/oauth/callback?...` and the locale-prefixed, trailing-slashed
   * one the apex 302s to), so comparing URLs would let a ticket be adopted
   * twice.
   */
  const handled = useRef(false);

  if (!OAUTH_ENABLED) return null;

  const close = (): void => setProvider(null);

  /**
   * Runs on EVERY navigation inside the WebView. Non-callback URLs load
   * normally; the callback is consumed here and never rendered.
   *
   * Android does not always fire onShouldStartLoadWithRequest for a server
   * side 302 (and the backend callback IS a redirect), so the same function
   * also runs from onNavigationStateChange.
   */
  const handleRequest = (url: string): boolean => {
    const result = parseOAuthCallback(url);
    if (result === null) return true;
    if (handled.current) return false;
    handled.current = true;
    close();
    if (result.kind === "error") {
      setError(t(oauthErrorKey(result.error)));
      return false;
    }
    if (result.kind === "token") {
      // Legacy branch, unreachable from this app and refused on purpose; see
      // OAuthCallbackResult in auth/oauthCallback.ts.
      setError(t(OAUTH_ERROR_KEYS.oauth_failed));
      return false;
    }
    setBusy(true);
    setError(null);
    void adoptOAuthTicket(result.ticket)
      .then(() => {
        // Success: the session store flips to authed and the root layout's
        // guards unmount this screen.
      })
      .catch((e: unknown) => {
        setError(authErrorMessage(classifyAdoptError(e), t));
      })
      .finally(() => setBusy(false));
    return false;
  };

  return (
    <View>
      <Divider />
      <AuthError message={error} />
      {oauthProvidersFor(mode).map((entry) => (
        <ProviderButton
          key={entry}
          label={t(PROVIDER_LABEL_KEYS[entry])}
          disabled={busy}
          onPress={() => {
            setError(null);
            handled.current = false;
            setProvider(entry);
          }}
        />
      ))}
      {busy ? <ActivityIndicator size="small" color={tokens.foreground} /> : null}
      <Modal
        visible={provider !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <View style={{ flex: 1, backgroundColor: tokens.background }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: tokens.border,
            }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "700" }}>
              {t("native.auth.oauth.sheetTitle")}
            </Text>
            <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
              <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
                {t("native.common.cancel")}
              </Text>
            </Pressable>
          </View>
          {provider ? (
            <WebView
              source={{ uri: buildOAuthUrl(provider, mode) }}
              incognito
              sharedCookiesEnabled={false}
              onShouldStartLoadWithRequest={(request) => handleRequest(request.url)}
              onNavigationStateChange={(state) => handleRequest(state.url)}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
