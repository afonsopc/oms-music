/**
 * Password reset screen (FR-11): reset_password_start (always 200,
 * anti-enumeration copy) -> code + new password -> reset_password_end ->
 * back to login with the email prefilled.
 */
import React, { useState } from "react";
import { useRouter } from "expo-router";
import { resetPasswordEnd, resetPasswordStart } from "@/auth/session";
import { isApiError } from "@/domain/api";
import { useT } from "@/i18n";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthInfo,
  AuthLinkRow,
  AuthScreen,
  AuthTitle,
  useApiErrorMessage,
} from "./ui";

type Step = "email" | "code" | "done";

const CODE_PATTERN = /^\d{6}$/;

export default function ResetScreen() {
  const t = useT();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async (): Promise<void> => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await resetPasswordStart(trimmed);
      setStep("code");
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (!CODE_PATTERN.test(code) || !password) return;
    setBusy(true);
    setError(null);
    try {
      await resetPasswordEnd(email.trim(), code, password);
      setStep("done");
    } catch (e) {
      if (isApiError(e) && e.status === 404) {
        setError(t("native.auth.signup.invalidCode"));
      } else {
        setError(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const goToLogin = (): void => {
    router.replace(`/(auth)/login?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <AuthScreen>
      <AuthTitle text={t("native.auth.reset.title")} />

      {step === "email" ? (
        <>
          <AuthInfo text={t("native.auth.reset.emailStepInfo")} />
          <AuthError message={error} />
          <AuthField
            label={t("native.auth.reset.email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            onSubmitEditing={() => void sendCode()}
          />
          <AuthButton
            label={t("native.auth.reset.sendCode")}
            onPress={() => void sendCode()}
            busy={busy}
            disabled={!email.trim()}
          />
          <AuthLinkRow label={t("native.auth.reset.back")} onPress={() => router.back()} />
        </>
      ) : null}

      {step === "code" ? (
        <>
          <AuthInfo text={t("native.auth.reset.sentInfo")} />
          <AuthError message={error} />
          <AuthField
            label={t("native.auth.reset.code")}
            value={code}
            onChangeText={(value) => setCode(value.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <AuthField
            label={t("native.auth.reset.newPassword")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            onSubmitEditing={() => void submit()}
          />
          <AuthButton
            label={t("native.auth.reset.submit")}
            onPress={() => void submit()}
            busy={busy}
            disabled={!CODE_PATTERN.test(code) || !password}
          />
          <AuthLinkRow
            label={t("native.auth.reset.back")}
            onPress={() => {
              setError(null);
              setStep("email");
            }}
          />
        </>
      ) : null}

      {step === "done" ? (
        <>
          <AuthInfo text={t("native.auth.reset.doneInfo")} />
          <AuthButton label={t("native.auth.reset.goToLogin")} onPress={goToLogin} />
        </>
      ) : null}
    </AuthScreen>
  );
}
