/**
 * Login screen (FR-7). One button: sign-in happens on Pocket ID
 * (id.omelhorsite.pt), with a passkey or an email code, and new accounts are
 * created there too. The app keeps no email/password form, no signup and no
 * reset of its own; the backend dropped those endpoints.
 *
 * The round trip runs in the SYSTEM browser - ASWebAuthenticationSession on
 * iOS, Custom Tabs on Android, a popup on web - via `expo-web-browser`'s
 * openAuthSessionAsync, so the browser's own cookies and passkeys apply and
 * the OS sheet is the trusted UI for auth.
 *
 * The flow: `/auth/pocket_id?mode=signin&native=1` (or `&app_origin=` on web)
 * -> Pocket ID -> backend callback -> `omsmusic://oauth/callback?ticket=...`
 * (or `<origin>/oauth/callback`). The ticket is exchanged through
 * POST /sessions/adopt within its 2 minute TTL by `adoptOAuthTicket`, which
 * lands on the shared `establishSession` path. Failures come back as
 * `?error=<code>` and map to the catalog through OAUTH_ERROR_KEYS; a cancel or
 * dismissal of the sheet is not an error and shows nothing.
 */
import React, { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { authErrorMessage, classifyAdoptError } from "@/auth/authErrors";
import {
  buildOAuthUrl,
  oauthErrorKey,
  oauthReturnUrl,
  parseOAuthCallback,
  OAUTH_ERROR_KEYS,
} from "@/auth/oauth";
import { adoptOAuthTicket } from "@/auth/session";
import { useT } from "@/i18n";
import { AuthButton, AuthError, AuthInfo, AuthScreen, AuthTitle } from "./ui";

export default function LoginScreen() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        buildOAuthUrl("pocket_id", "signin"),
        oauthReturnUrl(),
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
    } catch {
      setError(t(OAUTH_ERROR_KEYS.oauth_failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <AuthTitle text={t("native.auth.login.title")} />
      <AuthInfo text={t("native.auth.login.hint")} />
      <AuthError message={error} />
      <AuthButton
        label={t("native.auth.login.submit")}
        onPress={() => void start()}
        busy={busy}
      />
    </AuthScreen>
  );
}
