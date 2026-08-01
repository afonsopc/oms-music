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
  loopMode: LoopMode; // default "all"
  volume: number;
  rate: number; // 0.5..1.5 in the UI
  playbackMode: PlaybackMode;
  separationEnabled: boolean;
  vocalVolume: number;
  instrumentalVolume: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqEnabled: boolean;
  sleepTimer: { minutes: number; endsAt: number } | { endOfSong: true } | null;
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
  loopMode: "all",
  volume: 1,
  rate: 1,
  playbackMode: "original",
  separationEnabled: false,
  vocalVolume: 1,
  instrumentalVolume: 1,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  eqEnabled: false,
  sleepTimer: null,
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
