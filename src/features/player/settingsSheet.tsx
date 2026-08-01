/**
 * Now Playing cog sheet (FR-64 / FR-68 UI halves):
 *
 *  - playback rate 0.5..1.5 (deliberate pitch shift, engine side);
 *  - sleep timer: off / 5 / 10 / 15 / 30 / 60 minutes / end of song;
 *  - playback mode Original / Instrumental / Vocals, stem modes disabled
 *    while the stems do not exist, plus the "custom blend not available on
 *    this device" note when an adopted snapshot carries `custom`
 *    (DESIGN 16.1: the wire value is kept and republished, the audio plays
 *    the plain mix);
 *  - vocal separation status with a live elapsed timer and trigger/delete,
 *    through the frozen separation service interface (contracts/separation,
 *    implemented by WP11) - never for jam songs;
 *  - the EQ section is deliberately absent in v1 (DESIGN 16.2).
 *
 * Rate goes through the transport (a controller forwards it to the active
 * device); sleep timer and playback mode are LOCAL-ONLY settings and call
 * the engine directly, which is also why they read as local state.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { getTransport } from "@/contracts/transport";
import { getSeparationService, type SeparationStatus } from "@/contracts/separation";
import { formatDuration } from "@/domain/format";
import type { PlaybackMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { getPlayerEngine } from "@/player/register";
import { usePlayerStore } from "@/player/store";
import { useTheme } from "@/theme/provider";
import { BottomSheet, Icon } from "@/ui";

const K = "native.player";

const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
const SLEEP_MINUTES = [5, 10, 15, 30, 60] as const;
const MODES: readonly PlaybackMode[] = ["original", "instrumental", "vocals"];

const MODE_LABEL: Record<string, string> = {
  original: `${K}.modeOriginal`,
  instrumental: `${K}.modeInstrumental`,
  vocals: `${K}.modeVocals`,
};

const Chip = ({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: selected ? tokens.primary : tokens.secondary,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: selected ? tokens.primaryForeground : tokens.secondaryForeground,
          fontSize: 13,
          fontWeight: selected ? "700" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
};

/** Separation lifecycle for the current song (FR-71 UI half). */
const SeparationSection = ({ song }: { song: Song }) => {
  const t = useT();
  const { tokens } = useTheme();
  const service = getSeparationService();
  const status: SeparationStatus = service.useSeparationStatus(song.id);
  const hasStems = !!(song.vocals_fs_node_id && song.instrumental_fs_node_id);
  const busy = status.phase === "pending" || status.phase === "processing";

  const statusLine = busy
    ? t(`${K}.separating`, {
        elapsed: formatDuration(status.elapsedSeconds ?? 0),
      })
    : status.phase === "failed"
      ? t(`${K}.separationFailed`)
      : hasStems || status.phase === "ready"
        ? t(`${K}.separationReady`)
        : t(`${K}.separationIdle`);

  return (
    <Section title={t(`${K}.separation`)}>
      <Text style={{ color: tokens.foreground, fontSize: 13, marginBottom: 10 }}>{statusLine}</Text>
      {busy && status.progressPercent != null ? (
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: tokens.muted,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.max(0, Math.min(100, status.progressPercent))}%`,
              height: 4,
              backgroundColor: tokens.primary,
            }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {hasStems ? (
          <Chip
            label={t(`${K}.removeStems`)}
            selected={false}
            onPress={() => {
              void service.deleteSeparation(song.id);
            }}
          />
        ) : (
          <Chip
            label={t(`${K}.separate`)}
            selected={false}
            disabled={busy}
            onPress={() => {
              void service.triggerSeparation(song.id);
            }}
          />
        )}
      </View>
    </Section>
  );
};

export interface PlayerSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  song: Song | null;
}

export const PlayerSettingsSheet = ({ visible, onClose, song }: PlayerSettingsSheetProps) => {
  const t = useT();
  const { tokens } = useTheme();
  const rate = usePlayerStore((s) => s.rate);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);

  const sleepMinutes =
    sleepTimer && "minutes" in sleepTimer ? sleepTimer.minutes : null;
  const sleepEndOfSong = !!sleepTimer && "endOfSong" in sleepTimer;

  const stemsReady = !!(song?.vocals_fs_node_id && song?.instrumental_fs_node_id);
  // Jam proposals stream another user's presigned audio: they are never
  // separated and their stems never exist.
  const isJamSong = !!song?.jam_song;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text
        style={{
          color: tokens.foreground,
          fontSize: 16,
          fontWeight: "700",
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        {t(`${K}.audioSettings`)}
      </Text>

      <Section title={t(`${K}.speed`)}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {RATES.map((value) => (
            <Chip
              key={value}
              label={`${value}x`}
              selected={Math.abs(rate - value) < 0.01}
              onPress={() => getTransport().setRate(value)}
            />
          ))}
        </View>
      </Section>

      <Section title={t(`${K}.sleepTimer`)}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip
            label={t(`${K}.sleepOff`)}
            selected={!sleepTimer}
            onPress={() => getPlayerEngine().setSleepTimer(null)}
          />
          {SLEEP_MINUTES.map((minutes) => (
            <Chip
              key={minutes}
              label={t(`${K}.sleepMinutes`, { minutes })}
              selected={sleepMinutes === minutes}
              onPress={() => getPlayerEngine().setSleepTimer({ minutes })}
            />
          ))}
          <Chip
            label={t(`${K}.sleepEndOfSong`)}
            selected={sleepEndOfSong}
            onPress={() => getPlayerEngine().setSleepTimer({ endOfSong: true })}
          />
        </View>
      </Section>

      <Section title={t(`${K}.playbackMode`)}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {MODES.map((mode) => (
            <Chip
              key={mode}
              label={t(MODE_LABEL[mode])}
              selected={playbackMode === mode}
              disabled={mode !== "original" && !stemsReady}
              onPress={() => getPlayerEngine().setPlaybackMode(mode)}
            />
          ))}
        </View>
        {playbackMode === "custom" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
            <Icon name="alert-circle" size={14} color={tokens.mutedForeground} />
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, flex: 1 }}>
              {t(`${K}.modeCustomUnavailable`)}
            </Text>
          </View>
        ) : null}
        {!stemsReady ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 10 }}>
            {t(`${K}.stemsMissing`)}
          </Text>
        ) : null}
      </Section>

      {song && !isJamSong ? <SeparationSection song={song} /> : null}
      <View style={{ height: 12 }} />
    </BottomSheet>
  );
};
