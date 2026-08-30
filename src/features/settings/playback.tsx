/**
 * Playback settings (FR-98): the share_listening toggle. Read from the
 * account payload defaulting to TRUE when absent (web parity); written as
 * multipart PATCH /users/:id. Optimistic flip with rollback + inline error.
 */
import React, { useState } from "react";
import { Platform, ScrollView, Share, Text } from "react-native";
import { useUpdateUser } from "@/api/queries/users";
import { refreshAccount, useSessionStore } from "@/auth/session";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { playbackTraceText } from "@/player/trace";
import { useTheme } from "@/theme/provider";
import { NoticeBanner, SettingsRow, SettingsSection, SwitchRow } from "./ui";

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
  const [diagnosticsNote, setDiagnosticsNote] = useState<string | null>(null);

  // O trace do motor (player/trace.ts) existe para os bugs que só acontecem
  // no bolso do dono: copiar daqui e colar num issue substitui "liga o
  // profiler e tenta reproduzir". Na web vai para o clipboard; no nativo a
  // folha de partilha e o caminho universal sem dependências novas.
  const exportDiagnostics = (): void => {
    const text = playbackTraceText() || "(sem eventos ainda)";
    if (Platform.OS === "web") {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => setDiagnosticsNote(t("components.music.Settings.PlaybackPage.diagnosticsCopied")))
        .catch(() => setDiagnosticsNote(text.slice(0, 200)));
    } else {
      void Share.share({ message: text }).catch(() => undefined);
    }
  };

  const toggle = (next: boolean): void => {
    if (!user) return;
    setOverride(next);
    setError(null);
    updateUser.mutate(
      { shareListening: next },
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

      <SettingsSection>
        <SettingsRow
          first
          icon="audio-waveform"
          label={t("components.music.Settings.PlaybackPage.diagnosticsTitle")}
          detail={diagnosticsNote ?? t("components.music.Settings.PlaybackPage.diagnosticsDescription")}
          onPress={exportDiagnostics}
        />
      </SettingsSection>
    </ScrollView>
  );
}
