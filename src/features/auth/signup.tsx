/**
 * Signup screen (FR-8): email -> 6-digit OTP (a STEP, not a route) ->
 * name/password -> create_end (does NOT log in) -> immediate POST /sessions.
 * The resend button is disabled with a countdown, respecting the server's
 * 4/min + 20/h *_start buckets; a 429 feeds its retry_after straight into
 * the countdown.
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { login, signupEnd, signupStart } from "@/auth/session";
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

type Step = "email" | "code" | "details";

/** 4/min shared bucket -> never allow more than one send per 15 s; use 20. */
const RESEND_COOLDOWN_SECONDS = 20;

const CODE_PATTERN = /^\d{6}$/;

export default function SignupScreen() {
  const t = useT();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      await signupStart(trimmed);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep("code");
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        setError(t("native.auth.signup.emailTaken"));
      } else if (isApiError(e) && e.status === 429) {
        setCooldown(e.retryAfter ?? 60);
        setError(apiErrorMessage(e));
      } else {
        setError(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDetails = async (): Promise<void> => {
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signupEnd(email.trim(), code, trimmedName, password);
      // create_end does NOT log in (FR-8): follow with POST /sessions.
      await login(email.trim(), password);
      // Success: the root guards land on Home; this screen unmounts.
    } catch (e) {
      if (isApiError(e) && e.status === 404) {
        // "Invalid Verification": bad/expired code - back to the code step.
        setError(t("native.auth.signup.invalidCode"));
        setStep("code");
      } else {
        setError(apiErrorMessage(e));
      }
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <AuthTitle text={t("native.auth.signup.title")} />

      {step === "email" ? (
        <>
          <AuthInfo text={t("native.auth.signup.emailStepInfo")} />
          <AuthError message={error} />
          <AuthField
            label={t("native.auth.signup.email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            onSubmitEditing={() => void sendCode()}
          />
          <AuthButton
            label={
              cooldown > 0
                ? t("native.auth.signup.resendIn", { seconds: cooldown })
                : t("native.auth.signup.sendCode")
            }
            onPress={() => void sendCode()}
            busy={busy}
            disabled={!email.trim() || cooldown > 0}
          />
          <AuthLinkRow
            hint={t("native.auth.signup.haveAccount")}
            label={t("native.auth.signup.signIn")}
            onPress={() => router.back()}
          />
        </>
      ) : null}

      {step === "code" ? (
        <>
          <AuthInfo text={t("native.auth.signup.codeSentTo", { email: email.trim() })} />
          <AuthError message={error} />
          <AuthField
            label={t("native.auth.signup.code")}
            value={code}
            onChangeText={(value) => setCode(value.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <AuthButton
            label={t("native.auth.signup.continue")}
            onPress={() => {
              setError(null);
              setStep("details");
            }}
            disabled={!CODE_PATTERN.test(code)}
          />
          <AuthLinkRow
            label={
              cooldown > 0
                ? t("native.auth.signup.resendIn", { seconds: cooldown })
                : t("native.auth.signup.resend")
            }
            onPress={() => {
              if (cooldown === 0) void sendCode();
            }}
          />
          <AuthLinkRow
            label={t("native.auth.signup.back")}
            onPress={() => {
              setError(null);
              setStep("email");
            }}
          />
        </>
      ) : null}

      {step === "details" ? (
        <>
          <AuthInfo text={t("native.auth.signup.detailsTitle")} />
          <AuthError message={error} />
          <AuthField
            label={t("native.auth.signup.name")}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={50}
          />
          <AuthField
            label={t("native.auth.signup.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            onSubmitEditing={() => void submitDetails()}
          />
          <AuthButton
            label={t("native.auth.signup.submit")}
            onPress={() => void submitDetails()}
            busy={busy}
            disabled={!name.trim() || !password}
          />
          <AuthLinkRow
            label={t("native.auth.signup.back")}
            onPress={() => {
              setError(null);
              setStep("code");
            }}
          />
        </>
      ) : null}
    </AuthScreen>
  );
}
