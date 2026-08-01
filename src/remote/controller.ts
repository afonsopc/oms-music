/**
 * Controller-mode position tracking (FR-109; DESIGN 10.8).
 *
 * A controller has no audio loaded: the position it renders is the last
 * `position_tick` extrapolated by wall-clock elapsed time. Rules, all
 * mandatory:
 *
 * - ticks arrive at ~1 Hz from the active device; between them the display
 *   position is `tick.position + (now - tick.receivedAt) / 1000`;
 * - a tick older than STALE_TICK_MS (frozen app, quiet active device) is
 *   useless: fall back to the frozen snapshot position;
 * - ticks whose `song_id` differs from the snapshot song are DROPPED by the
 *   channel before they ever reach here (the previous track's position must
 *   not flash across a transition);
 * - the native ticker runs at 1 Hz, not per frame: the web used rAF because
 *   it was already painting every frame, but a 4 Hz+ store write on a phone
 *   is pure battery burn for a scrub bar that moves one second at a time.
 */
import { applyRemote, remoteStore } from "./store";
import type { PlaybackSnapshot } from "@/domain/playback";

/** Ticks older than this cannot be extrapolated (DESIGN 10.8). */
export const STALE_TICK_MS = 5_000;
/** Controller display refresh; the wire cadence is also 1 Hz. */
export const CONTROLLER_TICK_INTERVAL_MS = 1_000;

export interface PositionTick {
  position: number;
  paused: boolean;
  /** Wire ids are strings; null when the active device has no song. */
  songId: string | null;
  serverTimeMs: number;
  /** Local clock reading at receipt: the interpolation base. */
  receivedAtMs: number;
}

/** Seeds a tick from a full snapshot (subscribe / state_changed). */
export const tickFromSnapshot = (snap: PlaybackSnapshot, nowMs: number): PositionTick => ({
  position: snap.position ?? 0,
  paused: snap.paused ?? true,
  songId: snap.song_id == null ? null : String(snap.song_id),
  serverTimeMs: nowMs,
  receivedAtMs: nowMs,
});

/**
 * Pure interpolation (unit-tested): fresh tick -> extrapolate, stale tick ->
 * the snapshot position, no tick -> the snapshot position.
 */
export const interpolatedPosition = (
  tick: PositionTick | null,
  snapshotPosition: number,
  nowMs: number,
): number => {
  if (!tick) return Math.max(0, snapshotPosition);
  const ageMs = nowMs - tick.receivedAtMs;
  if (ageMs > STALE_TICK_MS || ageMs < 0) return Math.max(0, snapshotPosition);
  return Math.max(0, tick.position + ageMs / 1000);
};

export interface ControllerTickerDeps {
  getTick(): PositionTick | null;
  now(): number;
}

/**
 * Writes the interpolated position into the remote store while controlling.
 * Paused remotes still tick (cheap) so a remote seek-while-paused lands in
 * the UI within a second without a second timer.
 */
export class ControllerTicker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ControllerTickerDeps) {}

  start(): void {
    if (this.timer) return;
    this.publish();
    this.timer = setInterval(() => this.publish(), CONTROLLER_TICK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Recompute now (also used right after a snapshot lands). */
  publish(): void {
    const state = remoteStore.getState();
    if (state.role !== "controller") return;
    const tick = this.deps.getTick();
    // A paused remote holds its position; only a playing one advances.
    const paused = tick ? tick.paused : (state.snapshot?.paused ?? true);
    const position = paused
      ? (tick?.position ?? state.snapshot?.position ?? 0)
      : interpolatedPosition(tick, state.snapshot?.position ?? 0, this.deps.now());
    if (Math.abs(position - state.controllerPosition) < 0.05) return;
    applyRemote({ controllerPosition: position });
  }
}
