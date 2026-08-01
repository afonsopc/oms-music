/**
 * The MiniPlayer pill's read of the player store (WORKPLAN WP2.5: the pill
 * reads ONLY the player store and the transport contract). A cached
 * projection keeps the useSyncExternalStore snapshot referentially stable;
 * position ticks arrive at 4 Hz max per the store contract (FR-6).
 */
import { useSyncExternalStore } from "react";
import { playerStore } from "@/player/store";
import type { Song } from "@/domain/song";

export interface PillPlayerState {
  song: Song | null;
  playing: boolean;
  buffering: boolean;
  /** Seconds. */
  position: number;
  duration: number;
}

let cache: PillPlayerState = {
  song: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
};

const readPillState = (): PillPlayerState => {
  const state = playerStore.getState();
  const prev = cache;
  if (
    state.currentSong === prev.song &&
    state.playing === prev.playing &&
    state.buffering === prev.buffering &&
    state.position === prev.position &&
    state.duration === prev.duration
  ) {
    return prev;
  }
  cache = {
    song: state.currentSong,
    playing: state.playing,
    buffering: state.buffering,
    position: state.position,
    duration: state.duration,
  };
  return cache;
};

const subscribe = (cb: () => void): (() => void) => playerStore.subscribe(cb);

export const usePillPlayerState = (): PillPlayerState =>
  useSyncExternalStore(subscribe, readPillState, readPillState);
