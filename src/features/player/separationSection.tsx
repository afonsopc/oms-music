/**
 * The cog's vocal separation disclosure and the 3-band equalizer (FR-69 /
 * FR-70 UI halves), modelled on the web's CogDropdown "Vocal Separation" and
 * "Equalizer" blocks (frontend/components/MusicPlayer/CogDropdown.tsx).
 *
 * Web parity, deliberately:
 *  - the master switch is a DISCLOSURE. It never starts a separation and it
 *    never touches the mixer; turning it off forces the mode back to original
 *    (that cascade lives in the engine's setSeparationEnabledUserAction, and
 *    only a user action ever reaches it - remote adoption uses the raw setter);
 *  - the four modes are Original / Instrumental / Vocals / Custom blend, with
 *    the stem modes disabled until the backend produced the stems;
 *  - the two blend sliders are 0..1, step 0.01, default 1, and both at 1.0
 *    reproduce the original at roughly unity;
 *  - the EQ bands are -12..+12 dB, step 0.5, default 0, and `eqEnabled` is
 *    session-only (the engine never persists it).
 *
 * Native-only honesty, all of it visible rather than silent:
 *  - the blend plays from two LOCAL files, so entering custom mode on a song
 *    whose stems are not downloaded shows the transfer's progress while the
 *    plain mix keeps playing, and a failure offers Retry instead of a silent
 *    fallback (store: stemPhase / stemProgress, engine: retryStemBlend);
 *  - "Include separated stems" off in Download settings is respected: the
 *    fetch refuses rather than writing two files against an explicit
 *    preference, and this section offers the one-tap opt-in;
 *  - a build with no native mixer says so instead of pretending: the audio
 *    would be the plain mix, and the EQ is only in the mixer's path.
 */
import React from "react";
import { ActivityIndicator, Switch, Text, View } from "react-native";
import { getSeparationService, type SeparationStatus } from "@/contracts/separation";
import { updateDownloadSettings, useDownloadSettings } from "@/downloads/settings";
import { formatDuration } from "@/domain/format";
import type { EqBands, PlaybackMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { getPlayerEngine } from "@/player/register";
import { usePlayerStore } from "@/player/store";
import { useTheme } from "@/theme/provider";
import {
  dbFromFraction,
  formatBlend,
  formatDb,
  fractionFromDb,
  quantizeBlend,
} from "./blendMath";
import { Chip, NoteLine, ProgressBar, Section, SliderRow } from "./sheetControls";

const K = "native.player";

const MODES: readonly PlaybackMode[] = ["original", "instrumental", "vocals", "custom"];

const MODE_LABEL: Record<PlaybackMode, string> = {
  original: `${K}.modeOriginal`,
  instrumental: `${K}.modeInstrumental`,
  vocals: `${K}.modeVocals`,
  custom: `${K}.modeCustom`,
};

/** The backend run: queued / separating with a live clock, or its failure. */
const JobStatus = ({ status }: { status: SeparationStatus }) => {
  const t = useT();
  const { tokens } = useTheme();
  const elapsed = formatDuration(status.elapsedSeconds ?? 0);
  const queueAhead = status.job?.queue_position ?? 0;

  if (status.phase === "failed") {
    // The server's own message when it sent one (web parity), else the key.
    return <NoteLine tone="error" text={status.job?.error || t(`${K}.separationFailed`)} />;
  }
  if (status.phase !== "pending" && status.phase !== "processing") return null;

  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ActivityIndicator size="small" color={tokens.mutedForeground} />
        <Text style={{ color: tokens.foreground, fontSize: 13, flex: 1 }}>
          {status.phase === "pending"
            ? t(`${K}.separationQueued`, { elapsed })
            : t(`${K}.separating`, { elapsed })}
        </Text>
      </View>
      {status.phase === "pending" && queueAhead > 0 ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {t(`${K}.separationQueuePosition`, { count: queueAhead })}
        </Text>
      ) : null}
      {status.phase === "processing" &&
      status.progressPercent != null &&
      status.progressPercent > 0 ? (
        <ProgressBar fraction={status.progressPercent / 100} />
      ) : null}
    </View>
  );
};

/**
 * Everything that is true only in custom mode: where the two stem files are,
 * and what the user can do when they are not here yet.
 */
const BlendStatus = ({ disabled }: { disabled: boolean }) => {
  const t = useT();
  const stemPhase = usePlayerStore((s) => s.stemPhase);
  const stemProgress = usePlayerStore((s) => s.stemProgress);
  const settings = useDownloadSettings();

  if (stemPhase === "unsupported") {
    return <NoteLine text={t(`${K}.modeCustomUnavailable`)} />;
  }
  if (stemPhase === "fetching") {
    return (
      <View>
        <NoteLine
          text={t(`${K}.blendDownloading`, { percent: Math.round(stemProgress * 100) })}
        />
        <ProgressBar fraction={stemProgress} />
        <NoteLine text={t(`${K}.blendDownloadingHint`)} />
      </View>
    );
  }
  if (stemPhase === "failed") {
    // Two refusals the user can actually fix, told apart by the settings they
    // come from; anything else is the generic load failure.
    const stemsOff = !settings.includeStems;
    return (
      <View>
        <NoteLine
          tone="error"
          text={
            stemsOff
              ? t(`${K}.blendStemsDisabled`)
              : settings.wifiOnly
                ? t(`${K}.blendFailedWifi`)
                : t(`${K}.blendFailed`)
          }
        />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {stemsOff ? (
            <Chip
              label={t(`${K}.blendEnableStems`)}
              selected={false}
              disabled={disabled}
              onPress={() => {
                updateDownloadSettings({ includeStems: true });
                getPlayerEngine().retryStemBlend();
              }}
            />
          ) : null}
          <Chip
            label={t("native.common.retry")}
            selected={false}
            disabled={disabled}
            onPress={() => getPlayerEngine().retryStemBlend()}
          />
        </View>
      </View>
    );
  }
  if (stemPhase === "active") {
    return <NoteLine text={t(`${K}.blendActive`)} />;
  }
  return null;
};

export const SeparationSection = ({ song, disabled }: { song: Song; disabled: boolean }) => {
  const t = useT();
  const { tokens } = useTheme();
  const service = getSeparationService();
  const status = service.useSeparationStatus(song.id);
  const separationEnabled = usePlayerStore((s) => s.separationEnabled);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const vocalVolume = usePlayerStore((s) => s.vocalVolume);
  const instrumentalVolume = usePlayerStore((s) => s.instrumentalVolume);
  const stemMixerAvailable = usePlayerStore((s) => s.stemMixerAvailable);

  const stemsReady = !!(song.vocals_fs_node_id && song.instrumental_fs_node_id);
  // A re-run keeps the OLD stems attached until the new ones land, so a live
  // run must never be masked by stems being ready (web parity, SongCard 48-50).
  const busy = status.phase === "pending" || status.phase === "processing";
  const inCustom = playbackMode === "custom";

  return (
    <Section
      title={t(`${K}.separation`)}
      trailing={
        <Switch
          value={separationEnabled}
          disabled={disabled}
          accessibilityLabel={t(`${K}.separation`)}
          trackColor={{ true: tokens.primary }}
          onValueChange={(on) => getPlayerEngine().setSeparationEnabledUserAction(on)}
        />
      }
    >
      {/* A run in flight is a fact about the SONG, not a listening
          preference, so it stays visible with the disclosure closed: the
          trigger also lives in the song menu, and watching progress must not
          require flipping a switch that changes what you hear. */}
      <JobStatus status={status} />

      {!separationEnabled ? (
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 12,
            lineHeight: 17,
            marginTop: 8,
          }}
        >
          {t(`${K}.separationHint`)}
        </Text>
      ) : (
        <View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {MODES.map((mode) => (
              <Chip
                key={mode}
                label={t(MODE_LABEL[mode])}
                selected={playbackMode === mode}
                disabled={
                  disabled ||
                  (mode !== "original" && !stemsReady) ||
                  // No mixer in this build: custom would play the plain mix.
                  (mode === "custom" && !stemMixerAvailable)
                }
                onPress={() => getPlayerEngine().setPlaybackMode(mode)}
              />
            ))}
          </View>

          {!stemsReady ? <NoteLine text={t(`${K}.stemsMissing`)} /> : null}
          {stemsReady && !stemMixerAvailable && !inCustom ? (
            <NoteLine text={t(`${K}.modeCustomUnavailable`)} />
          ) : null}

          {inCustom ? (
            <View>
              <BlendStatus disabled={disabled} />
              <SliderRow
                label={t(`${K}.voiceVolume`)}
                valueLabel={formatBlend(vocalVolume)}
                value={vocalVolume}
                disabled={disabled}
                onChange={(fraction) =>
                  getPlayerEngine().setVocalVolume(quantizeBlend(fraction))
                }
              />
              <SliderRow
                label={t(`${K}.musicVolume`)}
                valueLabel={formatBlend(instrumentalVolume)}
                value={instrumentalVolume}
                disabled={disabled}
                onChange={(fraction) =>
                  getPlayerEngine().setInstrumentalVolume(quantizeBlend(fraction))
                }
              />
            </View>
          ) : null}

          {!stemsReady && !busy ? (
            <NoteLine text={t(`${K}.separationDescription`)} />
          ) : null}

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {stemsReady ? (
              <Chip
                label={t(`${K}.removeStems`)}
                selected={false}
                disabled={disabled}
                onPress={() => {
                  void service.deleteSeparation(song.id);
                }}
              />
            ) : null}
            {!stemsReady ? (
              <Chip
                label={t(`${K}.separate`)}
                selected={false}
                disabled={disabled || busy}
                onPress={() => {
                  void service.triggerSeparation(song.id);
                }}
              />
            ) : null}
          </View>
        </View>
      )}
    </Section>
  );
};

const EQ_BANDS: readonly (keyof EqBands)[] = ["low", "mid", "high"];
const EQ_LABEL: Record<keyof EqBands, string> = {
  low: `${K}.eqLow`,
  mid: `${K}.eqMid`,
  high: `${K}.eqHigh`,
};

export const EqualizerSection = ({ disabled }: { disabled: boolean }) => {
  const t = useT();
  const { tokens } = useTheme();
  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqLow = usePlayerStore((s) => s.eqLow);
  const eqMid = usePlayerStore((s) => s.eqMid);
  const eqHigh = usePlayerStore((s) => s.eqHigh);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const stemMixerAvailable = usePlayerStore((s) => s.stemMixerAvailable);

  const values: EqBands = { low: eqLow, mid: eqMid, high: eqHigh };
  const flat = eqLow === 0 && eqMid === 0 && eqHigh === 0;

  return (
    <Section
      title={t(`${K}.equalizer`)}
      trailing={
        <Switch
          value={eqEnabled}
          disabled={disabled}
          accessibilityLabel={t(`${K}.equalizer`)}
          trackColor={{ true: tokens.primary }}
          onValueChange={(on) => getPlayerEngine().setEqEnabled(on)}
        />
      }
    >
      {EQ_BANDS.map((band) => (
        <SliderRow
          key={band}
          label={t(EQ_LABEL[band])}
          valueLabel={formatDb(values[band])}
          value={fractionFromDb(values[band])}
          disabled={disabled || !eqEnabled}
          onChange={(fraction) => getPlayerEngine().setEqBand(band, dbFromFraction(fraction))}
        />
      ))}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Chip
          label={t(`${K}.eqReset`)}
          selected={false}
          disabled={disabled || flat}
          onPress={() => {
            const engine = getPlayerEngine();
            for (const band of EQ_BANDS) engine.setEqBand(band, 0);
          }}
        />
      </View>

      {/* The EQ lives in the mixer's chain, and the mixer only produces audio
          for the custom blend - saying so beats a knob that does nothing. */}
      {!eqEnabled ? (
        <NoteLine text={t(`${K}.eqOff`)} />
      ) : !stemMixerAvailable ? (
        <NoteLine text={t(`${K}.modeCustomUnavailable`)} />
      ) : playbackMode !== "custom" ? (
        <NoteLine text={t(`${K}.eqCustomOnly`)} />
      ) : null}
    </Section>
  );
};
