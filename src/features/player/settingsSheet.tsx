/**
 * Now Playing cog sheet (FR-64 / FR-68 / FR-69 / FR-70 UI halves):
 *
 *  - playback rate 0.5..1.5 (deliberate pitch shift, engine side);
 *  - sleep timer: off / 5 / 10 / 15 / 30 / 60 minutes / end of song;
 *  - the vocal separation disclosure: the master switch, the live job status,
 *    the four modes Original / Instrumental / Vocals / Custom blend, the two
 *    blend sliders and trigger / delete - all of it in separationSection.tsx,
 *    never for jam songs (one source, no stems, three independent guards);
 *  - the 3-band equalizer, same file.
 *
 * Everything in this sheet is DEVICE-LOCAL: rate stays local even through the
 * transport decorator (remote/transport.ts `setRate`), and sleep timer,
 * playback mode, separation and the blend call the engine / service directly.
 * While this device is CONTROLLING another one it owns no audio, so every one
 * of them is greyed out (FR-109 "local-only settings greyed out"; separation
 * is refused on controllers by DESIGN 8.7) exactly like the web threads
 * `localSettingsDisabled={isController}` into the same cog.
 */
import React from "react";
import { Text, View } from "react-native";
import { getTransport } from "@/contracts/transport";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { getPlayerEngine } from "@/player/register";
import { usePlayerStore } from "@/player/store";
import { useRemoteStore, type RemoteStoreState } from "@/remote/store";
import { useTheme } from "@/theme/provider";
import { BottomSheet, Icon } from "@/ui";
import { EqualizerSection, SeparationSection } from "./separationSection";
import { Chip, Section, SliderRow } from "./sheetControls";
import { fractionToRate, rateToFraction } from "./blendMath";

const K = "native.player";

const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
const SLEEP_MINUTES = [5, 10, 15, 30, 60] as const;

const selectIsController = (s: RemoteStoreState): boolean => s.role === "controller";

export interface PlayerSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  song: Song | null;
}

/**
 * O CORPO das definicoes de reproducao, sem moldura. Existe separado da
 * folha porque no telemovel deixou de haver folhas dentro do player: as
 * definicoes sao um MODO do palco, como as letras (decisao do dono
 * 2026-08-15). No desktop a barra de transporte continua a monta-lo numa
 * folha, que ali e a forma certa.
 */
export const PlayerSettingsBody = ({ song }: { song: Song | null }) => {
  const t = useT();
  const { tokens } = useTheme();
  const rate = usePlayerStore((s) => s.rate);
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  // Controlling another device: this player owns no audio, so every setting
  // in this sheet would write state nobody ever hears (FR-109).
  const localDisabled = useRemoteStore(selectIsController);

  const sleepMinutes =
    sleepTimer && "minutes" in sleepTimer ? sleepTimer.minutes : null;
  const sleepEndOfSong = !!sleepTimer && "endOfSong" in sleepTimer;

  // Jam proposals stream another user's presigned audio: they are never
  // separated and their stems never exist.
  const isJamSong = !!song?.jam_song;

  return (
    <>
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

      {localDisabled ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 20,
            paddingTop: 10,
          }}
        >
          <Icon name="alert-circle" size={14} color={tokens.mutedForeground} />
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, flex: 1 }}>
            {t(`${K}.localDeviceOnly`)}
          </Text>
        </View>
      ) : null}

      <Section title={t(`${K}.speed`)}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {RATES.map((value) => (
            <Chip
              key={value}
              label={`${value}x`}
              selected={Math.abs(rate - value) < 0.01}
              disabled={localDisabled}
              onPress={() => getTransport().setRate(value)}
            />
          ))}
        </View>
        {/* The chips are the quick presets; the track reaches everything in
            between, which the presets alone cannot express. */}
        <SliderRow
          label={t(`${K}.speed`)}
          valueLabel={`${rate.toFixed(2)}x`}
          value={rateToFraction(rate)}
          disabled={localDisabled}
          onChange={(fraction) => getTransport().setRate(fractionToRate(fraction))}
        />
      </Section>

      <Section title={t(`${K}.sleepTimer`)}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip
            label={t(`${K}.sleepOff`)}
            selected={!sleepTimer}
            disabled={localDisabled}
            onPress={() => getPlayerEngine().setSleepTimer(null)}
          />
          {SLEEP_MINUTES.map((minutes) => (
            <Chip
              key={minutes}
              label={t(`${K}.sleepMinutes`, { minutes })}
              selected={sleepMinutes === minutes}
              disabled={localDisabled}
              onPress={() => getPlayerEngine().setSleepTimer({ minutes })}
            />
          ))}
          <Chip
            label={t(`${K}.sleepEndOfSong`)}
            selected={sleepEndOfSong}
            disabled={localDisabled}
            onPress={() => getPlayerEngine().setSleepTimer({ endOfSong: true })}
          />
        </View>
      </Section>

      {song && !isJamSong ? (
        <SeparationSection song={song} disabled={localDisabled} />
      ) : null}

      <EqualizerSection disabled={localDisabled} />
      <View style={{ height: 12 }} />
    </>
  );
};

/** A folha, que hoje so o desktop usa (barra de transporte). */
export const PlayerSettingsSheet = ({ visible, onClose, song }: PlayerSettingsSheetProps) => {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <PlayerSettingsBody song={song} />
    </BottomSheet>
  );
};
