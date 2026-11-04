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
}

let cache: PillPlayerState = {
  song: null,
  playing: false,
  buffering: false,
};

const readPillState = (): PillPlayerState => {
  const state = getPlaybackView();
  const prev = cache;
  if (
    state.song === prev.song &&
    state.playing === prev.playing &&
    state.buffering === prev.buffering
  ) {
    return prev;
  }
  cache = {
    song: state.song,
    playing: state.playing,
    buffering: state.buffering,
  };
  return cache;
};

export const usePillPlayerState = (): PillPlayerState =>
  useSyncExternalStore(subscribePlaybackView, readPillState, readPillState);

/**
 * A fracção tocada, arredondada a 0,2 %: só a barra fina do mini-leitor ouve
 * a posição (4 Hz), o resto da pílula fica quieto.
 */
const readProgress = (): number => {
  const { position, duration } = getPlaybackView();
  if (!(duration > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, position / duration)) * 500) / 500;
};

export const usePillProgress = (): number =>
  useSyncExternalStore(subscribePlaybackView, readProgress, readProgress);
