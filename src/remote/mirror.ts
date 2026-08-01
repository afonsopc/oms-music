/**
 * Controller read model (FR-109; DESIGN 10.2 "Controller: mirror the
 * snapshot"). The write half of remote playback already exists - the
 * transport decorator turns every action into a validated `command`, the
 * ticker interpolates the 1 Hz position - and this is the read half.
 *
 * While another device owns audio this one is SILENT: `enterController()`
 * calls `engine.stopAndClearSource()`, which drops the source but
 * deliberately leaves the local queue quartet, current song, position and
 * duration exactly as they were. A surface reading the player store directly
 * would therefore render whatever this phone last played, with a frozen
 * scrub bar, while its buttons drive a completely different song on the
 * remote device (and a scrub would seek to `fraction * LOCAL duration`).
 *
 * So every playback-DISPLAY read goes through this projection: the local
 * store while active / no_active / offline, the merged snapshot plus the
 * interpolated tick while controlling. It is the native shape of the web's
 * `passive` swap in MusicProvider (exposedQueue/exposedSong/exposedPosition
 * ...), including its two subtleties: `controllerPaused` folds in the ticks
 * so it is fresher than the snapshot between broadcasts, and volume IS
 * shared (it is the active device's output) while rate, playback mode, EQ
 * and stem volumes stay device-local and keep reading the player store.
 */
import { useSyncExternalStore } from "react";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { initialPlayerState, playerStore, type PlayerStoreState } from "@/player/store";
import { snapshotCurrentSong } from "./snapshot";
import { initialRemoteState, remoteStore, type RemoteStoreState } from "./store";

export interface PlaybackView {
  /** True while another device owns audio: everything below is mirrored. */
  passive: boolean;
  song: Song | null;
  playing: boolean;
  buffering: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  queue: Song[];
  queueOrder: number[];
  queueIndex: number;
  shuffle: boolean;
  loopMode: LoopMode;
  volume: number;
  /** Device-LOCAL (never mirrored), exposed here for position estimation. */
  rate: number;
}

/** Stable empties: a fresh [] every read would break snapshot identity. */
const EMPTY_QUEUE: Song[] = [];
const EMPTY_ORDER: number[] = [];

/** Pure projection (unit-tested). */
export const computePlaybackView = (
  local: PlayerStoreState,
  remote: RemoteStoreState,
): PlaybackView => {
  if (remote.role !== "controller") {
    return {
      passive: false,
      song: local.currentSong,
      playing: local.playing,
      buffering: local.buffering,
      position: local.position,
      duration: local.duration,
      queue: local.queue,
      queueOrder: local.queueOrder,
      queueIndex: local.queueIndex,
      shuffle: local.shuffle,
      loopMode: local.loopMode,
      volume: local.volume,
      rate: local.rate,
    };
  }

  const snapshot = remote.snapshot;
  const song = snapshotCurrentSong(snapshot);
  return {
    passive: true,
    song,
    playing: !remote.controllerPaused,
    // A controller has nothing to buffer: the spinner belongs to the device
    // that actually holds the audio.
    buffering: false,
    position: remote.controllerPosition,
    // The remote song's own duration: the scrub bar maps drags back to
    // seconds with it, and the local source is gone anyway.
    duration: song?.duration ?? 0,
    queue: snapshot?.queue_songs ?? EMPTY_QUEUE,
    queueOrder: snapshot?.queue_order ?? EMPTY_ORDER,
    queueIndex: snapshot?.queue_index ?? 0,
    shuffle: snapshot?.shuffle ?? false,
    loopMode: snapshot?.loop_mode ?? local.loopMode,
    volume: snapshot?.volume ?? local.volume,
    // Rate is device-local on both sides, and the remote ticks already
    // arrive rate-adjusted: extrapolation runs at 1x while controlling.
    rate: 1,
  };
};

const sameView = (a: PlaybackView, b: PlaybackView): boolean =>
  a.passive === b.passive &&
  a.song === b.song &&
  a.playing === b.playing &&
  a.buffering === b.buffering &&
  a.position === b.position &&
  a.duration === b.duration &&
  a.queue === b.queue &&
  a.queueOrder === b.queueOrder &&
  a.queueIndex === b.queueIndex &&
  a.shuffle === b.shuffle &&
  a.loopMode === b.loopMode &&
  a.volume === b.volume &&
  a.rate === b.rate;

let cache: PlaybackView = computePlaybackView(initialPlayerState, initialRemoteState);

/**
 * The projection as of now, referentially stable while nothing it exposes
 * changed (useSyncExternalStore requires a cached snapshot).
 */
export const getPlaybackView = (): PlaybackView => {
  const next = computePlaybackView(playerStore.getState(), remoteStore.getState());
  if (sameView(cache, next)) return cache;
  cache = next;
  return next;
};

/** Both stores move the view: a role flip is a remote write, ticks local. */
export const subscribePlaybackView = (cb: () => void): (() => void) => {
  const unsubLocal = playerStore.subscribe(cb);
  const unsubRemote = remoteStore.subscribe(cb);
  return () => {
    unsubLocal();
    unsubRemote();
  };
};

/**
 * React hook; always pass a selector returning a primitive or a value that
 * is referentially stable across reads (same rule as the two stores).
 */
export const usePlaybackView = <T>(selector: (view: PlaybackView) => T): T => {
  const read = (): T => selector(getPlaybackView());
  return useSyncExternalStore(subscribePlaybackView, read, read);
};
