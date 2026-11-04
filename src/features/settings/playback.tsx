/**
 * Playback settings (FR-98): the share_listening toggle. Read from the
 * account payload defaulting to TRUE when absent (web parity); written as
 * multipart PATCH /users/:id. Optimistic flip with rollback + inline error.
 */
import React, { useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { useUpdateUser } from "@/api/queries/users";
import { refreshAccount, useSessionStore } from "@/auth/session";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import {
  LYRICS_DELAY_MAX_MS,
  LYRICS_DELAY_MIN_MS,
  LYRICS_DELAY_STEP_MS,
  setLyricsDelay,
  useLyricsDelay,
} from "@/lyrics/delay";
import { playbackTraceText } from "@/player/trace";
import { useTheme } from "@/theme/provider";
import { GhostIconButton } from "@/ui";
import { NoticeBanner, SettingsPage, SettingsRow, SettingsSection, SwitchRow } from "./ui";

export default function PlaybackSettingsScreen() {
  const t = useT();
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
        .then(() => {
          haptics.success();
          setDiagnosticsNote(t("components.music.Settings.PlaybackPage.diagnosticsCopied"));
        })
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
          haptics.success();
          // Refresh the session-store account so every consumer sees the
          // new flag; keep the optimistic value meanwhile.
          void refreshAccount()
            .catch(() => undefined)
            .finally(() => setOverride(null));
        },
        onError: () => {
          haptics.error();
          setOverride(null);
          setError(t("components.music.Settings.PlaybackPage.shareListeningError"));
        },
      },
    );
  };

  return (
    <SettingsPage title={t("components.music.Settings.PlaybackPage.title")}>
      {error ? <NoticeBanner kind="error" message={error} /> : null}

      <SettingsSection>
        <SwitchRow
          first
          label={t("components.music.Settings.PlaybackPage.shareListeningTitle")}
          detail={t("components.music.Settings.PlaybackPage.shareListeningDescription")}
          value={value}
          onValueChange={toggle}
          disabled={!user}
        />
      </SettingsSection>

      <SettingsSection>
        <LyricsDelayRow />
      </SettingsSection>

      {/* Para quando alguma coisa falha: fica em "Avançado", fora do caminho. */}
      <SettingsSection title={t("native.settings.advanced")}>
        <SettingsRow
          first
          label={t("components.music.Settings.PlaybackPage.diagnosticsTitle")}
          detail={diagnosticsNote ?? t("components.music.Settings.PlaybackPage.diagnosticsDescription")}
          onPress={exportDiagnostics}
        />
      </SettingsSection>
    </SettingsPage>
  );
}

/**
 * O atraso da letra deste aparelho (src/lyrics/delay.ts): de 20 em 20 ms,
 * para as saídas de som que chegam depois do que o leitor diz.
 */
const LyricsDelayRow = () => {
  const t = useT();
  const { tokens } = useTheme();
  const ms = useLyricsDelay((s) => s.ms);
  const step = (dir: 1 | -1): void => {
    haptics.select();
    setLyricsDelay(ms + dir * LYRICS_DELAY_STEP_MS);
  };
  return (
    <SettingsRow
      first
      label={t("components.music.Settings.PlaybackPage.lyricsDelayTitle")}
      detail={t("components.music.Settings.PlaybackPage.lyricsDelayDescription")}
      onPress={ms !== 0 ? () => setLyricsDelay(0) : undefined}
      trailing={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <GhostIconButton
            icon="chevron-left"
            size={18}
            disabled={ms <= LYRICS_DELAY_MIN_MS}
            onPress={() => step(-1)}
            accessibilityLabel={t("components.music.Settings.PlaybackPage.lyricsDelayEarlier")}
          />
          <Text style={{ color: tokens.foreground, fontVariant: ["tabular-nums"], minWidth: 64, textAlign: "center" }}>
            {ms > 0 ? `+${ms}` : ms} ms
          </Text>
          <GhostIconButton
            icon="chevron-right"
            size={18}
            disabled={ms >= LYRICS_DELAY_MAX_MS}
            onPress={() => step(1)}
            accessibilityLabel={t("components.music.Settings.PlaybackPage.lyricsDelayLater")}
          />
        </View>
      }
    />
  );
};
