/**
 * The MiniPlayer pill's read of playback state (WORKPLAN WP2.5: the pill
 * reads ONLY the playback projection and the transport contract). While this
 * device controls another one the projection mirrors the remote snapshot, so
 * the pill describes what is actually audible (FR-109); locally it is the
 * player store. A cached projection keeps the useSyncExternalStore snapshot
 * referentially stable; position ticks arrive at 4 Hz max per the store
 * contract (FR-6), 1 Hz while controlling.
 */
import { useSyncExternalStore } from "react";
import { getPlaybackView, subscribePlaybackView } from "@/remote/mirror";
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
  const state = getPlaybackView();
  const prev = cache;
  if (
    state.song === prev.song &&
    state.playing === prev.playing &&
    state.buffering === prev.buffering &&
    state.position === prev.position &&
    state.duration === prev.duration
  ) {
    return prev;
  }
  cache = {
    song: state.song,
    playing: state.playing,
    buffering: state.buffering,
    position: state.position,
    duration: state.duration,
  };
  return cache;
};

export const usePillPlayerState = (): PillPlayerState =>
  useSyncExternalStore(subscribePlaybackView, readPillState, readPillState);
