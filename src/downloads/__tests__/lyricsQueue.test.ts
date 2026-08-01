/**
 * Paced lyrics backfill queue (FR-81 write half): the bound that keeps a
 * bulk collection toggle and the whole-library repair pass from opening one
 * concurrent GET /lyrics per song against a 60/min bucket.
 */
import { describe, expect, it } from "bun:test";
import { LyricsFetchQueue } from "../lyricsQueue";

/** Deterministic clock + timer: `advance` fires whatever is due. */
const makeClock = () => {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    deps: {
      now: () => now,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ at: now + ms, fn });
      },
    },
    async advance(ms: number): Promise<void> {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      for (const timer of due) timers.splice(timers.indexOf(timer), 1);
      for (const timer of due) timer.fn();
      await flush();
    },
    get scheduled(): number {
      return timers.length;
    },
  };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

describe("LyricsFetchQueue", () => {
  it("runs one fetch at a time instead of a burst", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    let inFlight = 0;
    let peak = 0;
    const started: string[] = [];
    const release: (() => void)[] = [];

    for (let i = 0; i < 5; i++) {
      queue.enqueue(`song-${i}`, () => {
        started.push(`song-${i}`);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return new Promise<void>((resolve) => {
          release.push(() => {
            inFlight -= 1;
            resolve();
          });
        });
      });
    }
    await flush();

    expect(started).toEqual(["song-0"]);
    expect(peak).toBe(1);
    expect(queue.pending).toBe(4);

    release[0]!();
    await flush();
    // The gap has not elapsed yet: nothing else started.
    expect(started).toEqual(["song-0"]);
    await clock.advance(1000);
    expect(started).toEqual(["song-0", "song-1"]);
  });

  it("paces starts at most one per gap window", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    const started: number[] = [];
    for (let i = 0; i < 3; i++) {
      queue.enqueue(`song-${i}`, async () => {
        started.push(i);
      });
    }
    await flush();
    expect(started).toEqual([0]);
    await clock.advance(999);
    expect(started).toEqual([0]);
    await clock.advance(1);
    expect(started).toEqual([0, 1]);
    await clock.advance(1000);
    expect(started).toEqual([0, 1, 2]);
  });

  it("dedupes a song that is already queued", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    let runs = 0;
    const job = async (): Promise<void> => {
      runs += 1;
    };
    queue.enqueue("song-1", job);
    queue.enqueue("song-1", job);
    queue.enqueue("song-1", job);
    await flush();
    expect(runs).toBe(1);
    expect(queue.pending).toBe(0);
  });

  it("lets a settled song be re-enqueued by a later repair pass", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    let runs = 0;
    const failing = async (): Promise<void> => {
      runs += 1;
      throw new Error("429");
    };
    queue.enqueue("song-1", failing);
    await flush();
    expect(runs).toBe(1);
    await clock.advance(1000);
    queue.enqueue("song-1", failing);
    await clock.advance(1000);
    expect(runs).toBe(2);
  });

  it("honors a Retry-After pause before the next start", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    const started: number[] = [];
    queue.enqueue("song-0", async () => {
      started.push(0);
      queue.pauseFor(10_000);
      throw new Error("rate limited");
    });
    queue.enqueue("song-1", async () => {
      started.push(1);
    });
    await flush();
    expect(started).toEqual([0]);
    await clock.advance(5_000);
    expect(started).toEqual([0]);
    await clock.advance(5_000);
    expect(started).toEqual([0, 1]);
  });

  it("clamps an absurd Retry-After", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    const started: number[] = [];
    queue.enqueue("song-0", async () => {
      started.push(0);
      queue.pauseFor(60 * 60_000);
    });
    queue.enqueue("song-1", async () => {
      started.push(1);
    });
    await flush();
    await clock.advance(5 * 60_000);
    expect(started).toEqual([0, 1]);
  });

  it("clear() drops everything still waiting", async () => {
    const clock = makeClock();
    const queue = new LyricsFetchQueue(clock.deps, 1000);
    const started: number[] = [];
    for (let i = 0; i < 4; i++) {
      queue.enqueue(`song-${i}`, async () => {
        started.push(i);
      });
    }
    await flush();
    queue.clear();
    expect(queue.pending).toBe(0);
    await clock.advance(10_000);
    expect(started).toEqual([0]);
  });
});
