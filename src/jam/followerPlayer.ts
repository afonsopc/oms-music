/**
 * Jam follower player (FR-115). A SECOND dedicated audio player fed by the
 * host's presigned `JamState.song.audio_url`; the main engine stays silent
 * and completely untouched (a follower keeps their own queue intact).
 *
 * The rules, verbatim from docs/playback-core.md and design-playback.md 6.5:
 *
 * - track identity is `song.id`, NEVER the URL: presigned strings are cached
 *   server-side for ~5 h and rotate, and a signature rollover must not count
 *   as a track change and rebuffer;
 * - a new song sets the source and stores a pending seek to `state.position`,
 *   applied once the media reports a duration (seeking before metadata is
 *   dropped, so mid-song joins would start at 0);
 * - on `position_tick`: host paused -> hard pause; otherwise ensure playing
 *   and hard-seek only when the drift exceeds 2.5 s (constant seeking
 *   stutters audibly);
 * - a follower may pause LOCALLY without touching the jam; resuming
 *   extrapolates the last tick (`tick.position + (now - receivedAt)`) so they
 *   rejoin live rather than where they left;
 * - volume is purely local;
 * - the presigned URL is never persisted and its fs node is never resolved.
 */
import type { JamState } from "@/domain/jam";
import type { FollowerAudio, FollowerAudioStatus, FollowerPlayerApi } from "./types";

/** How far the follower may drift from the host before a hard seek (s). */
export const MAX_DRIFT_SECONDS = 2.5;

export interface FollowerTick {
  position: number;
  paused: boolean;
  songId: string | null;
  receivedAtMs: number;
}

/**
 * Where the host is NOW, given their last tick. Used when a follower lifts
 * their local pause: replaying from the pause point would put them behind
 * the room for the rest of the song.
 */
export const extrapolateTick = (tick: FollowerTick, nowMs: number): number => {
  if (tick.paused) return tick.position;
  const elapsed = Math.max(0, nowMs - tick.receivedAtMs) / 1000;
  return tick.position + elapsed;
};

export interface TickPlan {
  pause: boolean;
  play: boolean;
  /** Seconds to hard-seek to, or null to ride the current position. */
  seekTo: number | null;
}

/**
 * Pure tick decision (unit-tested). Split out of the player so the drift
 * rule is testable without an audio backend.
 */
export const planTick = (args: {
  hostPaused: boolean;
  localPaused: boolean;
  playing: boolean;
  localPosition: number;
  tickPosition: number;
}): TickPlan => {
  if (args.hostPaused) return { pause: true, play: false, seekTo: null };
  if (args.localPaused) return { pause: false, play: false, seekTo: null };
  const drift = Math.abs(args.localPosition - args.tickPosition);
  return {
    pause: false,
    play: !args.playing,
    seekTo: drift > MAX_DRIFT_SECONDS ? args.tickPosition : null,
  };
};

export interface FollowerPlayerDeps {
  createPlayer(): FollowerAudio;
  /** Position mirror for the JamBar (leaf store slice). */
  onPosition?(seconds: number): void;
  now?(): number;
}

export class FollowerPlayer implements FollowerPlayerApi {
  private player: FollowerAudio | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  /** Track identity: the jam song id currently loaded (never the URL). */
  private currentSongId: string | null = null;
  private pendingSeek: number | null = null;
  /** Bumped on every source swap; stale async seeks bail on mismatch. */
  private generation = 0;
  private lastTick: FollowerTick | null = null;
  private localPaused = false;
  private volume = 1;

  constructor(private readonly deps: FollowerPlayerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private ensurePlayer(): FollowerAudio {
    if (this.player) return this.player;
    const player = this.deps.createPlayer();
    player.setVolume(this.volume);
    this.unsubscribeStatus = player.onStatus((status) => this.onStatus(status));
    this.player = player;
    return player;
  }

  private onStatus(status: FollowerAudioStatus): void {
    // Metadata arrived: apply the seek a mid-song join needs.
    if (this.pendingSeek !== null && status.isLoaded && status.duration > 0) {
      const seconds = this.pendingSeek;
      const gen = this.generation;
      this.pendingSeek = null;
      const player = this.player;
      if (player) {
        void player.seekTo(seconds).catch(() => undefined);
        // A late source swap must not be dragged back to the old position.
        if (gen !== this.generation) return;
      }
    }
    this.deps.onPosition?.(status.currentTime);
  }

  /** Snapshot / state_changed from the jam stream. */
  applyState(state: JamState): void {
    const song = state.song ?? null;
    const url = song?.audio_url ?? null;
    this.lastTick = {
      position: state.position ?? 0,
      paused: !!state.paused,
      songId: song ? String(song.id) : null,
      receivedAtMs: this.now(),
    };

    if (!song || !url) {
      // The host has nothing loaded: go silent but stay in the jam.
      this.stopAudio();
      return;
    }

    const player = this.ensurePlayer();
    const songId = String(song.id);
    if (songId !== this.currentSongId) {
      this.currentSongId = songId;
      this.generation += 1;
      this.pendingSeek = state.position ?? 0;
      player.replace(url);
    }

    if (state.paused) {
      player.pause();
      return;
    }
    if (!this.localPaused) player.play();
  }

  /** position_tick from the jam stream (no song payload; correlate by id). */
  applyTick(tick: { position: number; paused: boolean; songId: string | null }): void {
    const position = Number.isFinite(tick.position) ? tick.position : 0;
    this.lastTick = {
      position,
      paused: !!tick.paused,
      songId: tick.songId,
      receivedAtMs: this.now(),
    };

    const player = this.player;
    if (!player || this.currentSongId === null) return;
    // A tick that raced a track change describes the previous song.
    if (tick.songId !== null && tick.songId !== this.currentSongId) return;

    const plan = planTick({
      hostPaused: !!tick.paused,
      localPaused: this.localPaused,
      playing: player.playing,
      localPosition: player.currentTime,
      tickPosition: position,
    });
    if (plan.pause) {
      player.pause();
      return;
    }
    if (plan.play) player.play();
    if (plan.seekTo !== null) void player.seekTo(plan.seekTo).catch(() => undefined);
  }

  setLocalPaused(paused: boolean): void {
    this.localPaused = paused;
    const player = this.player;
    if (!player) return;
    if (paused) {
      player.pause();
      return;
    }
    // Rejoin live: estimate where the host is now from the last tick.
    const tick = this.lastTick;
    if (!tick || tick.paused) return;
    void player.seekTo(extrapolateTick(tick, this.now())).catch(() => undefined);
    player.play();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.player?.setVolume(this.volume);
  }

  /** Leaving the jam: silence, forget the presigned URL, keep the player. */
  stop(): void {
    this.localPaused = false;
    this.stopAudio();
  }

  destroy(): void {
    this.stop();
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    this.player?.remove();
    this.player = null;
  }

  private stopAudio(): void {
    this.currentSongId = null;
    this.pendingSeek = null;
    this.generation += 1;
    this.lastTick = null;
    const player = this.player;
    if (!player) return;
    player.pause();
    player.replace(null);
    this.deps.onPosition?.(0);
  }
}
