/**
 * Spotify account-linking sheet (native): a WebView renders
 * `/auth/link/spotify?token=<session token>` and intercepts the hardcoded
 * https callback (the linking flow still uses the web callback; only LOGIN
 * moved to the system browser). Split into its own module so the web bundle
 * resolves ./linkSheet.web instead and never imports react-native-webview.
 */
import React from "react";
import { Modal, View } from "react-native";
import { WebView } from "react-native-webview";
import { buildLinkUrl, oauthErrorKey, parseOAuthCallback } from "@/auth/oauth";
import { GhostButton } from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface LinkSheetProps {
  visible: boolean;
  /** `errorKey` is set when the callback carried `?error=<code>`. */
  onDone: (errorKey?: string) => void;
}

/**
 * Consumes the linking callback. The backend always lands on the hardcoded
 * https callback and we are already signed in, so the ticket it carries is for
 * a session this app does not need and is deliberately ignored.
 *
 * What must NOT be ignored is `?error=`: Spotify linking is gated on the
 * admin-set `users.allowed_to_use_spotify` flag (Spotify Dev Mode allowlists
 * every address by hand), and `IdentitiesController#link` refuses with
 * `?error=spotify_not_allowlisted` (`identities_controller.rb:27-33`) before
 * the provider is ever reached. Closing the sheet silently on that made the
 * button look broken; now the refusal is explained.
 */
const handleCallback = (url: string, onDone: (errorKey?: string) => void): boolean => {
  const result = parseOAuthCallback(url);
  if (result === null) return true;
  onDone(result.kind === "error" ? oauthErrorKey(result.error) : undefined);
  return false;
};

export const LinkSheet = ({ visible, onDone }: LinkSheetProps) => {
  const { tokens } = useTheme();
  const t = useT();
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onDone()}>
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            padding: 12,
            borderBottomWidth: 1,
            borderBottomColor: tokens.border,
          }}
        >
          <GhostButton label={t("native.common.cancel")} compact onPress={() => onDone()} />
        </View>
        <WebView
          source={{ uri: buildLinkUrl("spotify") }}
          incognito
          onShouldStartLoadWithRequest={(request) => handleCallback(request.url, onDone)}
          onNavigationStateChange={(state) => {
            // Android often reports only the FINAL url of a redirect chain,
            // and the backend callback IS a redirect.
            handleCallback(state.url, onDone);
          }}
        />
      </View>
    </Modal>
  );
};
