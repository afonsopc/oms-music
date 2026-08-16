/**
 * Zustand UI mirror of the engine (DESIGN 7.2, frozen shape). The store is a
 * MIRROR: the synchronous source of truth for the quartet is a ref inside
 * the engine. Scrub bars, the lock screen and all UI read the store, never
 * the AudioPlayer. Position lives in a leaf slice updated at 4 Hz max
 * (FR-6 no-interrupt discipline) - select it in isolation.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { SongKey } from "@/domain/ids";
import type { LoopMode, PlaybackMode } from "@/domain/playback";
import type { Song } from "@/domain/song";

/**
 * What the custom blend is doing right now (DESIGN 16.1 amendment
 * 2026-08-03). Purely a UI read: the audible truth is the mixer's.
 *
 *  - `off`         not in custom mode, or the song has no stems;
 *  - `unsupported` custom mode but this build has no mixer (plain mix plays);
 *  - `fetching`    both stems downloading; the plain mix stays audible;
 *  - `active`      the mixer owns the audio, the original is muted;
 *  - `failed`      the stems could not be fetched or loaded; plain mix plays.
 */
export type StemPhase = "off" | "unsupported" | "fetching" | "active" | "failed";

export interface PlayerStoreState {
  queue: Song[];
  queueOrder: number[];
  queueIndex: number;
  shuffle: boolean;
  currentSong: Song | null;
  position: number; // leaf slice, 4 Hz max
  duration: number;
  playing: boolean;
  buffering: boolean;
  /**
   * WEB ONLY affordance: the browser's autoplay policy rejected play()
   * before any user gesture reached this origin (typically a remote play
   * adopted by a tab nobody ever touched). The UI shows "toca para ouvir";
   * any engine play intent clears it. Always false on native.
   */
  autoplayBlocked: boolean;
  loopMode: LoopMode; // default "all"
  volume: number;
  /**
   * Whether the volume slider can do anything at all. False only on iOS
   * Safari, where HTMLMediaElement.volume is read-only and output belongs to
   * the hardware buttons - the owner reported the bar as simply broken there
   * (2026-08-16, point 7). The surfaces hide the control rather than draw a
   * slider that moves and changes nothing.
   */
  volumeSupported: boolean;
  rate: number; // 0.5..1.5 in the UI
  playbackMode: PlaybackMode;
  separationEnabled: boolean;
  vocalVolume: number;
  instrumentalVolume: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqEnabled: boolean;
  /** Custom blend lifecycle; drives the cog's blend section (FR-69). */
  stemPhase: StemPhase;
  /** 0..1 while `stemPhase` is "fetching", else 0. */
  stemProgress: number;
  /** Capability read: whether a stem mixer exists in this build at all. */
  stemMixerAvailable: boolean;
  /**
   * True while the mixer graph (stems OR the EQ passthrough) is live, i.e.
   * while the EQ actually colours the audio. The cog uses it to say WHY a
   * non-flat EQ is having no effect (streamed song with no local file).
   */
  eqActive: boolean;
  sleepTimer: { minutes: number; endsAt: number } | { endOfSong: true } | null;
  /**
   * Loop de secção A-B (player/abLoop.ts): pontos em segundos, null = por
   * marcar. SESSION-ONLY e local ao dispositivo que ouve - nunca persiste
   * nem viaja pelo cabo; a UI esconde a feature em modo controlador.
   */
  abLoopA: number | null;
  abLoopB: number | null;
  failedSongKeys: ReadonlySet<SongKey>;
}

export const initialPlayerState: PlayerStoreState = {
  queue: [],
  queueOrder: [],
  queueIndex: 0,
  shuffle: false,
  currentSong: null,
  position: 0,
  duration: 0,
  playing: false,
  buffering: false,
  autoplayBlocked: false,
  loopMode: "all",
  volume: 1,
  volumeSupported: true,
  rate: 1,
  playbackMode: "original",
  separationEnabled: false,
  vocalVolume: 1,
  instrumentalVolume: 1,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  eqEnabled: false,
  stemPhase: "off",
  stemProgress: 0,
  stemMixerAvailable: false,
  eqActive: false,
  sleepTimer: null,
  abLoopA: null,
  abLoopB: null,
  failedSongKeys: new Set<SongKey>(),
};

export const playerStore = createStore<PlayerStoreState>()(() => ({
  ...initialPlayerState,
}));

/** React hook; always pass a selector (keep them pure and stable). */
export const usePlayerStore = <T>(selector: (state: PlayerStoreState) => T): T =>
  useStore(playerStore, selector);

/** Reset to boot state (logout wipe). The engine calls this. */
export const resetPlayerStore = (): void => {
  playerStore.setState({ ...initialPlayerState, failedSongKeys: new Set<SongKey>() }, true);
};
