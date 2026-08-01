/**
 * Jam subsystem seams. The follower runs a SECOND audio player (DESIGN 10.3)
 * that must never touch the main engine, the lock screen, the play-event
 * accumulator or the download scheduler. It is expressed here as a narrow
 * interface so `followerPlayer.ts` runs under bun with a fake, exactly like
 * the engine's AudioAdapter; `jam/expoFollowerAudio.ts` is the only file
 * that knows about expo-audio and is imported solely from register.ts.
 *
 * Deliberately NOT part of this interface: setActiveForLockScreen and
 * updateLockScreenMetadata. The lock screen belongs to the main engine (the
 * user's own playback); a follower stream never claims it.
 */

export interface FollowerAudioStatus {
  currentTime: number;
  duration: number;
  playing: boolean;
  isLoaded: boolean;
}

export interface FollowerAudio {
  readonly currentTime: number;
  readonly playing: boolean;
  /** Replace the source; null clears it. Jam URLs are presigned, never nodes. */
  replace(uri: string | null): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  setVolume(v: number): void;
  onStatus(cb: (s: FollowerAudioStatus) => void): () => void;
  remove(): void;
}

/** The follower half the channel drives (kept small for fakes in tests). */
export interface FollowerPlayerApi {
  /** Full jam state (snapshot / state_changed). */
  applyState(state: import("@/domain/jam").JamState): void;
  /** 1 Hz host tick (position_tick). */
  applyTick(tick: { position: number; paused: boolean; songId: string | null }): void;
  /** Local-only pause; resume extrapolates the last tick. */
  setLocalPaused(paused: boolean): void;
  setVolume(volume: number): void;
  /** Leaving the jam: silence and forget everything. */
  stop(): void;
  /** Teardown (logout). */
  destroy(): void;
}
