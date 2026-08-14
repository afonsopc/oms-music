/**
 * The direct regression test for invariant I1 on desktop: the coarse download
 * status channel must bump on status TRANSITIONS ONLY, and percent samples
 * must ride the ~1 Hz progress channel instead.
 *
 * This is the property the 2026-08-14 freeze report bought, and the desktop
 * fork is where it is easiest to lose by accident: the events arrive from Rust
 * as a single stream and it costs one careless line to route every one of them
 * through the coarse channel. So the test feeds a synthetic `CacheEvent`
 * stream into `events.ts` with the REAL `status.ts` as the sink and watches
 * both counters.
 *
 * Both channels are timer-throttled (250 ms coarse, 1000 ms progress), so the
 * assertions are on notified-versus-not after the timers drain, never on the
 * exact count within a window.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  getProgressVersion,
  getStatusVersion,
  resetStatuses,
  subscribeDownloadProgress,
  subscribeDownloadStatus,
} from "../status";
import { applyCacheEvent, setCacheEventObserver } from "../desktop/events";
import type { CacheEvent, CacheStatus } from "../desktop/bridge";

/** Both channels coalesce on a timer; wait past the slower one (1000 ms). */
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_100));

/** Several real drains per case, so the default 5 s budget is not enough. */
const TIMEOUT_MS = 20_000;

const status = (songKey: string, value: CacheStatus, progress = 0): CacheEvent => ({
  type: "status",
  songKey,
  kind: "mixed",
  status: value,
  progress,
});

const progress = (songKey: string, value: number): CacheEvent => ({
  type: "progress",
  songKey,
  kind: "mixed",
  progress: value,
});

describe("desktop cache events", () => {
  beforeEach(() => {
    resetStatuses();
    setCacheEventObserver(null);
  });

  it("bumps the coarse channel on a transition and not on progress", async () => {
    const unsubscribeCoarse = subscribeDownloadStatus(() => {});
    const unsubscribeProgress = subscribeDownloadProgress(() => {});
    await drain();

    const coarseBefore = getStatusVersion();
    applyCacheEvent(status("1", "queued"));
    await drain();
    expect(getStatusVersion()).toBeGreaterThan(coarseBefore);

    // Progress samples: the status string does not change, so the coarse
    // counter must stand perfectly still while the progress one moves.
    applyCacheEvent(status("1", "downloading", 0));
    await drain();
    const coarseAfterStart = getStatusVersion();
    const progressBefore = getProgressVersion();
    for (let i = 1; i <= 20; i += 1) applyCacheEvent(progress("1", i / 20));
    await drain();
    expect(getStatusVersion()).toBe(coarseAfterStart);
    expect(getProgressVersion()).toBeGreaterThan(progressBefore);

    // And the terminal transition bumps the coarse one again.
    applyCacheEvent(status("1", "done", 1));
    await drain();
    expect(getStatusVersion()).toBeGreaterThan(coarseAfterStart);

    unsubscribeCoarse();
    unsubscribeProgress();
  }, TIMEOUT_MS);

  it("keeps a repeated status event off the coarse channel", async () => {
    subscribeDownloadStatus(() => {});
    await drain();
    applyCacheEvent(status("2", "downloading", 0.1));
    await drain();
    const before = getStatusVersion();
    // Rust throttles, but a re-emitted identical status must be harmless here
    // too: this is the optimistic-queued path (the fork sets `queued` on click
    // and Rust echoes it milliseconds later).
    applyCacheEvent(status("2", "downloading", 0.2));
    applyCacheEvent(status("2", "downloading", 0.3));
    await drain();
    expect(getStatusVersion()).toBe(before);
  }, TIMEOUT_MS);

  it("forwards every event to the observer, progress included", () => {
    const seen: CacheEvent[] = [];
    setCacheEventObserver((event) => seen.push(event));
    applyCacheEvent(status("3", "queued"));
    applyCacheEvent(progress("3", 0.5));
    applyCacheEvent(status("3", "done", 1));
    expect(seen.map((e) => e.type)).toEqual(["status", "progress", "status"]);
    expect(seen.every((e) => e.songKey === "3")).toBe(true);
  });
});
