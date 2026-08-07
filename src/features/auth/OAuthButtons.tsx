/**
 * OAuth sign-in buttons (FR-12). The provider round trip runs in the SYSTEM
 * browser - ASWebAuthenticationSession on iOS, Custom Tabs on Android - via
 * `expo-web-browser`'s openAuthSessionAsync:
 *
 *  - cookies are the browser's own, so a user already signed into Google or
 *    GitHub just taps "continue" instead of re-entering credentials;
 *  - Google ALLOWS this surface (it blocks embedded webviews with
 *    `disallowed_useragent`), which is what put the Google button back;
 *  - the OS sheet is the trusted UI for auth - an in-app webview asking for
 *    a Google password is indistinguishable from a phishing page.
 *
 * The flow: `/auth/<provider>?mode=<mode>&native=1` -> provider -> backend
 * callback -> redirect to `omsmusic://oauth/callback?ticket=...` (the backend
 * answers native flows on the app scheme), which the session watches for and
 * hands back here. The ticket is exchanged through POST /sessions/adopt
 * within its 2 minute TTL, then handed to the shared `establishSession` path
 * so OAuth lands exactly like a password login. Failures come back as
 * `?error=<code>` and map to the catalog through OAUTH_ERROR_KEYS; a cancel
 * or dismissal of the sheet is not an error and shows nothing.
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { authErrorMessage, classifyAdoptError } from "@/auth/authErrors";
import {
  buildOAuthUrl,
  oauthErrorKey,
  oauthProvidersFor,
  parseOAuthCallback,
  OAUTH_ERROR_KEYS,
  OAUTH_NATIVE_CALLBACK,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!OAUTH_ENABLED) return null;

  const start = async (provider: OAuthProvider): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        buildOAuthUrl(provider, mode),
        OAUTH_NATIVE_CALLBACK,
      );
      // "cancel"/"dismiss": the user closed the sheet - not an error.
      if (result.type !== "success") return;
      const parsed = parseOAuthCallback(result.url);
      if (parsed === null || parsed.kind === "token") {
        // An unknown shape, or the legacy raw-token branch this app refuses
        // on purpose (adopting a token straight out of a URL is a session
        // fixation primitive).
        setError(t(OAUTH_ERROR_KEYS.oauth_failed));
        return;
      }
      if (parsed.kind === "error") {
        setError(t(oauthErrorKey(parsed.error)));
        return;
      }
      await adoptOAuthTicket(parsed.ticket).catch((e: unknown) => {
        setError(authErrorMessage(classifyAdoptError(e), t));
      });
      // Success: the session store flips to authed and the root layout's
      // guards unmount this screen.
    } finally {
      setBusy(false);
    }
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
          onPress={() => void start(entry)}
        />
      ))}
      {busy ? <ActivityIndicator size="small" color={tokens.foreground} /> : null}
    </View>
  );
}
