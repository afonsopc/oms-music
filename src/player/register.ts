/**
 * Player subsystem wiring, imported by boot/wireup.ts (WP12). Creates the
 * engine singleton over the real expo-audio adapter, registers it as the
 * base transport (contracts/transport), configures the audio session
 * (playback category, background, doNotMix - required for lock screen
 * association), keeps the lock screen fed on every song / play-state /
 * metadata change, and registers the logout wipe (FR-10 / DESIGN 5.3) next to
 * the cable's, the jam manager's and the download scheduler's.
 */
import { setAudioModeAsync } from "expo-audio";
import { registerLogoutTask } from "@/auth/session";
import { setBaseTransport, type TransportActions } from "@/contracts/transport";
import { resolveDataUrl } from "@/api/endpoints/fsNodes";
import { postPlayEvent } from "@/api/endpoints/playEvents";
import type { Song } from "@/domain/song";
import { PlayerEngineImpl } from "./engine";
import { createExpoAudioAdapter } from "./expoAudioAdapter";
import { createListenerSettingsPersistence } from "./persistence";
import { publishLockScreen } from "./lockScreen";
import type { AudioAdapter } from "./types";

let engine: PlayerEngineImpl | null = null;

const engineTransport = (e: PlayerEngineImpl): TransportActions => ({
  play: () => e.play(),
  pause: () => e.pause(),
  toggle: () => e.toggle(),
  next: () => e.next(),
  previous: () => e.previous(),
  seek: (seconds) => e.seek(seconds),
  setVolume: (volume) => e.setVolume(volume),
  setRate: (rate) => e.setRate(rate),
  setLoopMode: (mode) => e.setLoopMode(mode),
  setShuffle: (on) => e.setShuffle(on),
  setQueueIndex: (visibleIndex) => e.setQueueIndex(visibleIndex),
  addToQueue: (song) => e.addToQueue(song),
  playNext: (song) => e.playNext(song),
  removeFromQueue: (visibleIndex) => e.removeFromQueue(visibleIndex),
  reorderQueue: (fromVisible, toVisible) => e.reorderQueue(fromVisible, toVisible),
  setQueue: (songs, startIndex, opts) => e.setQueue(songs, startIndex, opts),
});

/** Idempotent: boot calls this once; late callers get the same singleton. */
export const registerPlayerEngine = (): PlayerEngineImpl => {
  if (engine) return engine;

  let adapter: AudioAdapter | null = null;
  const created = new PlayerEngineImpl({
    createPlayer: () => {
      adapter = createExpoAudioAdapter();
      return adapter;
    },
    resolveDataUrl,
    recordPlay: (songId) => {
      // Fire-and-forget: never surface failures (server dedupes 30 s repeats).
      void postPlayEvent(songId).catch(() => undefined);
    },
    persistence: createListenerSettingsPersistence(),
    onLockScreenUpdate: (song: Song | null) => {
      if (adapter) publishLockScreen(adapter, song);
    },
  });
  engine = created;

  setBaseTransport(engineTransport(created));

  // Logout / auth loss: stop the audio, drop the previous user's queue and
  // clear the lock screen. Runs even when DELETE /sessions/current fails.
  registerLogoutTask(() => {
    created.resetForLogout();
  });

  // Playback category + background + doNotMix: without doNotMix the OS may
  // not associate lock screen controls with the player (expo-audio docs);
  // without setActiveForLockScreen Android kills background audio at ~3 min.
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: "doNotMix",
  }).catch(() => undefined);

  return created;
};

/** The engine singleton; registers on first use if boot has not yet. */
export const getPlayerEngine = (): PlayerEngineImpl => registerPlayerEngine();
