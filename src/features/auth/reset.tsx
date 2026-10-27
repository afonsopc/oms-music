/**
 * Password reset screen (FR-11): reset_password_start (always 200,
 * anti-enumeration copy) -> code + new password -> reset_password_end ->
 * back to login with the email prefilled.
 *
 * Same code contract as signup: 15 minutes, five wrong guesses and the code is
 * destroyed, and the server reports all three failures as one 404. The screen
 * carries an OtpBudget so the message says which. `reset_password_end` also
 * consumes the code before touching the account, so a rejected new password
 * (422) leaves a spent code behind, and it destroys EVERY session of that user
 * on success (user.rb:73) - which is why this flow always ends at the login
 * screen rather than signing anyone in.
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  authErrorMessage,
  classifyCodeRequestError,
  classifyCodeSubmitError,
} from "@/auth/authErrors";
import { isOtpShape, otpIssued, otpWrongGuess, OTP_UNSENT } from "@/auth/otp";
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
} from "./ui";

type Step = "email" | "code" | "done";

/** Same floor as signup: the `verify_start` bucket is 4/min per IP, shared. */
const RESEND_COOLDOWN_SECONDS = 20;

export default function ResetScreen() {
  const t = useT();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(OTP_UNSENT);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendCode = async (): Promise<void> => {
    if (busy || cooldown > 0) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await resetPasswordStart(trimmed);
      setBudget(otpIssued(Date.now()));
      // reset_password_start shares the 4/min + 20/h `verify_start` bucket
      // with signup, so it gets the same client-side floor.
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep("code");
    } catch (e) {
      const info = classifyCodeRequestError(e);
      if (info.code === "rateLimited") setCooldown(Number(info.params.seconds ?? 60));
      setError(authErrorMessage(info, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (!isOtpShape(code) || !password) return;
    setBusy(true);
    setError(null);
    try {
      await resetPasswordEnd(email.trim(), code, password);
      setStep("done");
    } catch (e) {
      const charged = otpWrongGuess(budget);
      const info = classifyCodeSubmitError(e, charged, Date.now());
      if (isApiError(e) && e.status === 404) {
        // Wrong, expired or burned code, or an email with no account: the
        // server charged an attempt for every one of them except the last.
        if (info.code !== "accountNotFound") setBudget(charged);
      } else if (isApiError(e) && e.status === 422) {
        // The code was verified and destroyed before the password update, so
        // a rejected password needs a brand new code.
        setBudget(OTP_UNSENT);
        setError(`${authErrorMessage(info, t)} ${t("native.auth.errors.codeConsumed")}`);
        setStep("email");
        return;
      }
      setError(authErrorMessage(info, t));
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
            label={
              cooldown > 0
                ? // Same countdown copy as signup: it is the same server bucket.
                  t("native.auth.signup.resendIn", { seconds: cooldown })
                : t("native.auth.reset.sendCode")
            }
            onPress={() => void sendCode()}
            busy={busy}
            disabled={!email.trim() || cooldown > 0}
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
            disabled={!isOtpShape(code) || !password}
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
