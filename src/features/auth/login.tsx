/**
 * Login screen (FR-7). Email + password -> POST /sessions via the WP1 auth
 * service; on success the session store flips to authed and the root layout's
 * guards land on Home. Failures go through classifyLoginError, which tells the
 * four real outcomes apart (wrong credentials, deactivated account, rate
 * limit with a countdown, server fault) instead of one generic message.
 * OAuth buttons (GitHub, Spotify) run the WebView ticket flow (FR-12).
 *
 * The passkey button (FR-13) sits ABOVE the email field, mirroring the web
 * client's order, because the ceremony is discoverable-credential: it needs
 * neither an email nor a password, so sending the user to the form first would
 * be backwards. It hides itself when the platform cannot do passkeys, so on
 * such a device this screen looks exactly as it did before.
 */
import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { authErrorMessage, classifyLoginError } from "@/auth/authErrors";
import { login } from "@/auth/session";
import { useT } from "@/i18n";
import OAuthButtons from "./OAuthButtons";
import PasskeyButton from "./PasskeyButton";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLinkRow,
  AuthScreen,
  AuthTitle,
} from "./ui";

export default function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Seconds left on the server's 429; POST /sessions allows 10/min per IP. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (): Promise<void> => {
    if (busy || cooldown > 0) return;
    const trimmed = email.trim();
    if (!trimmed || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(trimmed, password);
      // Success: SessionGate/guards switch to (main); this screen unmounts.
    } catch (e) {
      // classifyLoginError separates the four outcomes POST /sessions really
      // has: 401 wrong credentials, 422 DEACTIVATED account (empty body),
      // 429 with a retry countdown, and 5xx.
      const info = classifyLoginError(e);
      // Hold the button for the window the server reported rather than let the
      // user spend the rest of the bucket on requests that cannot succeed.
      if (info.code === "rateLimited") setCooldown(Number(info.params.seconds ?? 60));
      setError(authErrorMessage(info, t));
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <AuthTitle text={t("native.auth.login.title")} />
      <AuthError message={error} />
      {/* Discoverable-credential ceremony: no email, no password, so it goes
          first, exactly like the web client. Hides itself when the platform
          cannot do passkeys. */}
      <PasskeyButton />
      <AuthField
        label={t("native.auth.login.email")}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />
      <AuthField
        label={t("native.auth.login.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={() => void submit()}
      />
      <AuthButton
        label={
          cooldown > 0
            ? t("native.auth.login.retryIn", { seconds: cooldown })
            : t("native.auth.login.submit")
        }
        onPress={() => void submit()}
        busy={busy}
        disabled={!email.trim() || !password || cooldown > 0}
      />
      <OAuthButtons />
      <AuthLinkRow
        label={t("native.auth.login.forgotPassword")}
        onPress={() => router.push("/(auth)/reset")}
      />
      <AuthLinkRow
        hint={t("native.auth.login.noAccount")}
        label={t("native.auth.login.createAccount")}
        onPress={() => router.push("/(auth)/signup")}
      />
    </AuthScreen>
  );
}
