/**
 * Passkey sign-in button (FR-13).
 *
 * The ceremony is discoverable-credential: the server answers
 * `allowCredentials: []` (`webauthn_credentials_controller.rb:63-69`) and the
 * authenticator picks the account, so there is deliberately no email field and
 * no dependency on anything the login form holds. One tap is the whole flow.
 *
 * Availability gating. `usePasskeysAvailable()` resolves to null while the
 * one-shot probe runs and the button stays hidden until it answers, so an
 * unlinked native module or an OS that is too old never renders a control that
 * cannot work. It is a real probe, not a platform guess: the module import is
 * wrapped, because requireNativeModule throws when the module is not linked.
 *
 * What it does NOT promise is a usable authenticator. A simulator with no
 * enrolled biometrics reports "supported" and then fails the ceremony with
 * `noAuthenticator`, which arrives here as a translated sentence rather than a
 * crash. That is the honest split: hide what provably cannot work, explain
 * what merely did not.
 *
 * Failure copy is deliberately not uniform. A dismissal shows nothing at all;
 * no passkey on the device, an OS that is too old, and a missing or wrong
 * domain association each get their own message, because during rollout the
 * .well-known files may not be live yet and "Something went wrong" would send
 * the user hunting for a fault on their side.
 *
 * Rate limiting. Signing in spends TWO requests from the same 20/min per-IP
 * bucket (rack_attack throttles every path under
 * /webauthn_credentials/authentication, which covers the options call and the
 * assertion), so about ten attempts a minute is the real ceiling. On a 429 the
 * button parks itself for the server's own retry_after and counts down, the
 * same shape the signup screen uses for the verification-code bucket.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { classifyPasskeyFailure, passkeyErrorMessage } from "@/auth/passkeyErrors";
import { usePasskeysAvailable } from "@/auth/passkeys";
import { loginWithPasskey } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { AuthError } from "./ui";

export default function PasskeyButton() {
  const t = useT();
  const { tokens } = useTheme();
  const available = usePasskeysAvailable();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // null = still probing. Hidden either way; nothing here should flicker in.
  if (available !== true) return null;

  const parked = cooldown > 0;
  const disabled = busy || parked;

  const signIn = async (): Promise<void> => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      // Success: the store flips to authed and the root guards unmount this.
    } catch (e) {
      const info = classifyPasskeyFailure(e);
      if (info.retryAfter) setCooldown(info.retryAfter);
      // A dismissal resolves to null: clear the slot rather than shout.
      setError(passkeyErrorMessage(info, t));
      setBusy(false);
    }
  };

  return (
    <View style={{ marginBottom: 18 }}>
      <AuthError message={error} />
      <PasskeyPressable
        label={
          parked
            ? t("native.auth.passkey.retryIn", { seconds: cooldown })
            : t("native.auth.passkey.signIn")
        }
        busy={busy}
        disabled={disabled}
        onPress={() => void signIn()}
      />
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 12,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        {t("native.auth.passkey.signInHint")}
      </Text>
    </View>
  );
}

/**
 * Styled like the OAuth providers rather than the primary submit: it is an
 * alternative way in, not the main one, and the password form below stays the
 * obvious default while passkeys are still rolling out.
 */
const PasskeyPressable = ({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: tokens.secondary,
        borderColor: tokens.border,
        borderWidth: 1,
        opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
        borderRadius: 999,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tokens.secondaryForeground} />
      ) : (
        <Text style={{ color: tokens.secondaryForeground, fontSize: 15, fontWeight: "600" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};
