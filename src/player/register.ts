/**
 * Player subsystem wiring, imported by boot/wireup.ts (WP12). Creates the
 * engine singleton over the real expo-audio adapter, registers it as the
 * base transport (contracts/transport), configures the audio session
 * (playback category, background, doNotMix - required for lock screen
 * association), keeps the lock screen fed on every song / play-state /
 * metadata change, wires the oms-native next/previous lock-screen commands
 * into the transport seam (FR-63), installs the native stem mixer behind the
 * custom-blend seam (FR-69 / FR-70), and registers the logout wipe
 * (FR-10 / DESIGN 5.3) next to the cable's, the jam manager's and the download
 * scheduler's.
 */
import { setAudioModeAsync } from "expo-audio";
import { registerLogoutTask } from "@/auth/session";
import { setStemMixer } from "@/contracts/stemMixer";
import { setBaseTransport, type TransportActions } from "@/contracts/transport";
import { resolveDataUrl } from "@/api/endpoints/fsNodes";
import { postPlayEvent } from "@/api/endpoints/playEvents";
import type { Song } from "@/domain/song";
import { PlayerEngineImpl } from "./engine";
import { createExpoAudioAdapter } from "./expoAudioAdapter";
import { createListenerSettingsPersistence } from "./persistence";
import { publishLockScreen, routeRemoteCommand, setRemoteTrackRouter } from "./lockScreen";
import type { AudioAdapter } from "./types";
import {
  createRemoteTrackRouter,
  getNativeStemMixer,
  getRemoteTrackCommands,
} from "../../modules/oms-native";

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

  // FR-69 / FR-70 custom blend. Installed BEFORE the engine is constructed:
  // the constructor seeds `stemMixerAvailable` from the adapter, and the
  // adapter answers that from this seam. Without a native mixer in the binary
  // (Expo Go, web, an older build) the bridge reports itself unavailable, so
  // `custom` mode keeps falling back to the plain mix instead of throwing.
  setStemMixer(getNativeStemMixer());

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

  // FR-63 lock-screen next/previous. The local `oms-native` module owns the
  // two MPRemoteCommandCenter commands expo-audio never registers; the events
  // land on routeRemoteCommand, which dispatches through contracts/transport,
  // so on a controller device they advance the ACTIVE device. Inert wherever
  // the native module is absent (Android, web, Expo Go).
  setRemoteTrackRouter(
    createRemoteTrackRouter(getRemoteTrackCommands(), (kind) => {
      routeRemoteCommand({ kind });
    }),
  );

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
