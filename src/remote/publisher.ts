/**
 * Active-device publishing (FR-110): a 200 ms debounced `state_changed` on
 * any change of song / queue quartet / loop / volume / playing / listener
 * settings (position is READ at publish time, never a trigger), plus
 * `position_tick` at 1 Hz while playing. Song ids ride AS STRINGS.
 *
 * Publishes are suppressed while `activating` (the first audible status
 * force-publishes truth) and while `blocked` (never publish the phantom
 * paused:true of a refused start) - FR-111. Values are already clamped at
 * the store (rate 0.25..4, EQ +-12, volumes 0..1), matching server clamps.
 */
import type { PlayerStoreState } from "@/player/store";
import { publishedQueue } from "./publishedQueue";
import { remoteStore } from "./store";
import type { LocalPlaybackState } from "./localPlayer";

const PUBLISH_DEBOUNCE_MS = 200;
const TICK_INTERVAL_MS = 1_000;

export interface PublisherDeps {
  perform(action: string, data?: Record<string, unknown>): void;
  localState: LocalPlaybackState;
}

const changeSignature = (s: PlayerStoreState): string =>
  [
    s.currentSong ? String(s.currentSong.id) : "-",
    s.queue.map((song) => song.id).join(","),
    s.queueIndex,
    s.queueOrder.join(","),
    s.shuffle,
    s.loopMode,
    s.volume,
    s.playing,
    s.rate,
    s.playbackMode,
    s.eqLow,
    s.eqMid,
    s.eqHigh,
    s.eqEnabled,
    s.separationEnabled,
    s.vocalVolume,
    s.instrumentalVolume,
  ].join("|");

export class ActivePublisher {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unsubLocal: (() => void) | null = null;
  private unsubRemote: (() => void) | null = null;
  private lastSignature: string | null = null;
  private started = false;

  constructor(private readonly deps: PublisherDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubLocal = this.deps.localState.subscribe(() => this.onLocalChange());
    this.unsubRemote = remoteStore.subscribe(() => this.syncGating());
    this.syncGating();
  }

  stop(): void {
    this.started = false;
    this.unsubLocal?.();
    this.unsubLocal = null;
    this.unsubRemote?.();
    this.unsubRemote = null;
    this.clearDebounce();
    this.stopTicks();
    this.lastSignature = null;
  }

  /** role active, not activating, not blocked. */
  private get publishing(): boolean {
    const s = remoteStore.getState();
    return this.started && s.role === "active" && !s.activating && !s.blocked;
  }

  private onLocalChange(): void {
    if (!this.publishing) return;
    this.syncTicks();
    const signature = changeSignature(this.deps.localState.getState());
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.schedulePublish();
  }

  private syncGating(): void {
    if (this.publishing) {
      // Freshly publishing (promotion / activation complete): broadcast the
      // local truth after the debounce so nobody sits on a stale snapshot.
      if (this.lastSignature === null) {
        this.lastSignature = changeSignature(this.deps.localState.getState());
        this.schedulePublish();
      }
      this.syncTicks();
    } else {
      this.clearDebounce();
      this.stopTicks();
      this.lastSignature = null;
    }
  }

  private schedulePublish(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.publishing) this.publishNow();
    }, PUBLISH_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private syncTicks(): void {
    const shouldTick = this.publishing && this.deps.localState.getState().playing;
    if (shouldTick && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.publishTick(), TICK_INTERVAL_MS);
    } else if (!shouldTick && this.tickTimer) {
      this.stopTicks();
    }
  }

  private stopTicks(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private buildPayload(): Record<string, unknown> {
    const s = this.deps.localState.getState();
    // A voz do DJ nao viaja: ver ./publishedQueue.ts.
    const published = publishedQueue(s);
    return {
      song_id: published.songId,
      queue: published.queue,
      queue_index: published.queueIndex,
      queue_order: published.queueOrder,
      loop_mode: s.loopMode,
      shuffle: s.shuffle,
      volume: s.volume,
      paused: !s.playing,
      position: s.position,
      playback_rate: s.rate,
      playback_mode: s.playbackMode,
      eq_low: s.eqLow,
      eq_mid: s.eqMid,
      eq_high: s.eqHigh,
      eq_enabled: s.eqEnabled,
      separation_enabled: s.separationEnabled,
      vocal_volume: s.vocalVolume,
      instrumental_volume: s.instrumentalVolume,
    };
  }

  private publishNow(): void {
    this.deps.perform("state_changed", { payload: this.buildPayload() });
  }

  private publishTick(): void {
    const s = this.deps.localState.getState();
    this.deps.perform("position_tick", {
      position: s.position,
      paused: !s.playing,
      song_id: publishedQueue(s).songId,
    });
  }

  /**
   * Immediate full publish + tick: after an activation's first audible
   * status and after a reconnect steal (FR-112), so other devices never sit
   * on a stale paused snapshot.
   */
  forcePublishNow(): void {
    this.lastSignature = changeSignature(this.deps.localState.getState());
    this.publishNow();
    this.publishTick();
    this.syncTicks();
  }
}
