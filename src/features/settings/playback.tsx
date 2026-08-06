/**
 * Playback settings (FR-98): the share_listening toggle. Read from the
 * account payload defaulting to TRUE when absent (web parity); written as
 * multipart PATCH /users/:id. Optimistic flip with rollback + inline error.
 */
import React, { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useUpdateUser } from "@/api/queries/users";
import { refreshAccount, useSessionStore } from "@/auth/session";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { NoticeBanner, SettingsSection, SwitchRow } from "./ui";

export default function PlaybackSettingsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const user = useSessionStore((s) => s.user);
  const updateUser = useUpdateUser();

  // null = follow the account payload; a boolean = optimistic local value.
  const [override, setOverride] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountValue = user?.share_listening ?? true;
  const value = override ?? accountValue;

  const toggle = (next: boolean): void => {
    if (!user) return;
    setOverride(next);
    setError(null);
    updateUser.mutate(
      { id: user.id, fields: { share_listening: next } },
      {
        onSuccess: () => {
          // Refresh the session-store account so every consumer sees the
          // new flag; keep the optimistic value meanwhile.
          void refreshAccount()
            .catch(() => undefined)
            .finally(() => setOverride(null));
        },
        onError: () => {
          setOverride(null);
          setError(t("components.music.Settings.PlaybackPage.shareListeningError"));
        },
      },
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 16 }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t("components.music.Settings.PlaybackPage.title")}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
        {t("components.music.Settings.PlaybackPage.subtitle")}
      </Text>

      {error ? <NoticeBanner kind="error" message={error} /> : null}

      <SettingsSection>
        <SwitchRow
          first
          label={t("components.music.Settings.PlaybackPage.shareListeningTitle")}
          detail={t("components.music.Settings.PlaybackPage.shareListeningDescription")}
          value={value}
          onValueChange={toggle}
          disabled={!user || updateUser.isPending}
        />
      </SettingsSection>
    </ScrollView>
  );
}
