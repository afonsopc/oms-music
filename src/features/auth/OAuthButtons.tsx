/**
 * OAuth sign-in buttons (FR-12, P1). react-native-webview is installed, so
 * the WebView interception flow is live: the button opens
 * `/auth/<provider>?mode=signin` in a modal WebView, `onShouldStartLoadWithRequest`
 * catches the hardcoded `https://omelhorsite.pt/account/oauth/callback` redirect
 * (there is no custom-scheme redirect server-side and adding one would need a
 * backend change), and the extracted ticket is exchanged through
 * `POST /sessions/adopt` within its 2 minute TTL. Failures come back as
 * `?error=<code>` and map to the catalog through OAUTH_ERROR_KEYS.
 *
 * GitHub and Spotify ship. Google stays hidden in v1: Google refuses embedded
 * WebViews with `disallowed_useragent` and the frontend-only "open in app"
 * bounce that fixes it is the follow-up in DESIGN 16.4. The `/sessions/adopt`
 * plumbing below is provider-agnostic, so turning Google on later is a
 * one-line change to OAUTH_PROVIDERS.
 *
 * The WebView runs `incognito`: the provider round trip needs its own cookie
 * jar, but nothing about it may persist (native auth is bearer-token only).
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  buildOAuthUrl,
  OAUTH_ERROR_KEYS,
  parseOAuthCallback,
  type OAuthErrorCode,
  type OAuthProvider,
} from "@/auth/oauth";
import { adoptOAuthTicket } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { AuthError } from "./ui";

export const OAUTH_ENABLED = true as boolean;

/** Google omitted on purpose (DESIGN 16.4). */
const OAUTH_PROVIDERS: { provider: OAuthProvider; labelKey: string }[] = [
  { provider: "github", labelKey: "native.auth.oauth.github" },
  { provider: "spotify", labelKey: "native.auth.oauth.spotify" },
];

const errorKeyFor = (code: string): string =>
  OAUTH_ERROR_KEYS[code as OAuthErrorCode] ?? OAUTH_ERROR_KEYS.oauth_failed;

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

export default function OAuthButtons() {
  const t = useT();
  const { tokens } = useTheme();
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Callback URL already consumed (both interception paths fire on Android). */
  const handled = useRef<string | null>(null);

  if (!OAUTH_ENABLED) return null;

  const close = (): void => setProvider(null);

  /**
   * Runs on EVERY navigation inside the WebView. Non-callback URLs load
   * normally; the callback is consumed here and never rendered.
   *
   * Android does not always fire onShouldStartLoadWithRequest for a server
   * side 302 (and the backend callback IS a redirect), so the same function
   * also runs from onNavigationStateChange; `handled` keeps the ticket from
   * being adopted twice.
   */
  const handleRequest = (url: string): boolean => {
    const result = parseOAuthCallback(url);
    if (result === null) return true;
    if (handled.current === url) return false;
    handled.current = url;
    close();
    if (result.kind === "error") {
      setError(t(errorKeyFor(result.error)));
      return false;
    }
    setBusy(true);
    setError(null);
    void adoptOAuthTicket(result.ticket)
      .then(() => {
        // Success: the session store flips to authed and the root layout's
        // guards unmount this screen.
      })
      .catch(() => {
        setError(t(OAUTH_ERROR_KEYS.oauth_failed));
      })
      .finally(() => setBusy(false));
    return false;
  };

  return (
    <View>
      <Divider />
      <AuthError message={error} />
      {OAUTH_PROVIDERS.map((entry) => (
        <ProviderButton
          key={entry.provider}
          label={t(entry.labelKey)}
          disabled={busy}
          onPress={() => {
            setError(null);
            handled.current = null;
            setProvider(entry.provider);
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
              source={{ uri: buildOAuthUrl(provider, "signin") }}
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
