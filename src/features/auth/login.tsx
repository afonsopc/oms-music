/**
 * Login screen (FR-7). Email + password -> POST /sessions via the WP1 auth
 * service; on success the session store flips to authed and the root layout's
 * guards land on Home. 401 shows the inline invalid-credentials message; 429
 * shows the retry-after countdown message. OAuth buttons (GitHub, Spotify) run
 * the WebView ticket flow (FR-12); no passkey button (FR-13 deferred).
 */
import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { login } from "@/auth/session";
import { isApiError } from "@/domain/api";
import { useT } from "@/i18n";
import OAuthButtons from "./OAuthButtons";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLinkRow,
  AuthScreen,
  AuthTitle,
  useApiErrorMessage,
} from "./ui";

export default function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const apiErrorMessage = useApiErrorMessage();

  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(trimmed, password);
      // Success: SessionGate/guards switch to (main); this screen unmounts.
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        setError(t("native.auth.login.invalidCredentials"));
      } else {
        setError(apiErrorMessage(e));
      }
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <AuthTitle text={t("native.auth.login.title")} />
      <AuthError message={error} />
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
        label={t("native.auth.login.submit")}
        onPress={() => void submit()}
        busy={busy}
        disabled={!email.trim() || !password}
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
