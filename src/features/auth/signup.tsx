/**
 * Signup screen (FR-8): email -> 6-digit OTP (a STEP, not a route) ->
 * name/password -> create_end (does NOT log in) -> immediate POST /sessions.
 * The resend button is disabled with a countdown, respecting the server's
 * 4/min + 20/h *_start buckets; a 429 feeds its retry_after straight into
 * the countdown.
 *
 * The code has a real budget the server never reports back: 15 minutes of
 * life, and the FIFTH wrong guess destroys it. `create_end` answers the same
 * 404 "Invalid Verification" for wrong, expired and burned, so the screen
 * tracks its own OtpBudget and says which one it is. It also consumes the
 * code BEFORE creating the account, so a 422 on the account fields leaves the
 * user with a spent code and no account: that path sends them back to the
 * email step with both facts on screen.
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  authErrorMessage,
  classifyCodeRequestError,
  classifyCodeSubmitError,
  classifyLoginError,
} from "@/auth/authErrors";
import { isOtpShape, otpIssued, otpState, otpWrongGuess, OTP_UNSENT } from "@/auth/otp";
import { login, signupEnd, signupStart } from "@/auth/session";
import { isApiError } from "@/domain/api";
import { useT } from "@/i18n";
import OAuthButtons from "./OAuthButtons";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthInfo,
  AuthLinkRow,
  AuthScreen,
  AuthTitle,
} from "./ui";

type Step = "email" | "code" | "details";

/** 4/min shared bucket -> never allow more than one send per 15 s; use 20. */
const RESEND_COOLDOWN_SECONDS = 20;

export default function SignupScreen() {
  const t = useT();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [budget, setBudget] = useState(OTP_UNSENT);

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
      // A fresh code replaces any previous one server side, so the local
      // budget resets with it.
      setBudget(otpIssued(Date.now()));
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

  /** Local pre-flight so a dead code does not spend a request or an attempt. */
  const continueFromCode = (): void => {
    const state = otpState(budget, Date.now());
    if (state === "burned" || state === "expired") {
      setError(
        t(
          state === "burned"
            ? "native.auth.errors.codeBurned"
            : "native.auth.errors.codeExpired",
        ),
      );
      return;
    }
    setError(null);
    setStep("details");
  };

  const submitDetails = async (): Promise<void> => {
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName || !password) return;
    setBusy(true);
    setError(null);
    let accountCreated = false;
    try {
      await signupEnd(email.trim(), code, trimmedName, password);
      accountCreated = true;
      // create_end does NOT log in (FR-8): follow with POST /sessions.
      await login(email.trim(), password);
      // Success: the root guards land on Home; this screen unmounts.
    } catch (e) {
      if (accountCreated) {
        // The account exists; only the chained sign-in failed. Send them to
        // the login screen with the address prefilled rather than pretending
        // signup failed and inviting a duplicate attempt.
        setError(authErrorMessage(classifyLoginError(e), t));
        router.replace(`/(auth)/login?email=${encodeURIComponent(email.trim())}`);
        setBusy(false);
        return;
      }
      const charged = otpWrongGuess(budget);
      const info = classifyCodeSubmitError(e, charged, Date.now());
      if (isApiError(e) && e.status === 404) {
        // Wrong, expired or burned: the server charged an attempt either way.
        setBudget(charged);
        setError(authErrorMessage(info, t));
        setStep("code");
      } else if (isApiError(e) && e.status === 422) {
        // create_end verifies (and DESTROYS) the code before User.create, so a
        // rejected name/password leaves no account and no usable code.
        setBudget(OTP_UNSENT);
        setError(`${authErrorMessage(info, t)} ${t("native.auth.errors.codeConsumed")}`);
        setStep("email");
      } else {
        setError(authErrorMessage(info, t));
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
          <OAuthButtons mode="signup" />
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
            onPress={continueFromCode}
            disabled={!isOtpShape(code)}
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
