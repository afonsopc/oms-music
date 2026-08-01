/**
 * Property tests over the queue quartet (FR-57 AC): order is always a
 * permutation, the index is always valid, and remove/reorder never change
 * the audible song - checked over randomized op sequences plus the exact
 * example semantics from the web MusicProvider.
 */
import { describe, expect, it } from "bun:test";
import type { QueueState } from "@/domain/playback";
import * as ops from "../queueOps";
import { makeSong } from "./fakes";

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const invariants = (state: QueueState, label: string): void => {
  if (!ops.isPermutation(state.queueOrder, state.queue.length)) {
    throw new Error(`${label}: order is not a permutation`);
  }
  if (state.queue.length === 0) {
    expect(state.queueIndex).toBe(0);
  } else if (state.queueIndex < 0 || state.queueIndex >= state.queueOrder.length) {
    throw new Error(`${label}: index ${state.queueIndex} out of order bounds`);
  }
};

describe("queueOps invariants over random op sequences", () => {
  it("holds order-permutation and index-validity across 200 random sequences", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      let nextId = 1;
      let state = ops.setQueue(
        Array.from({ length: 1 + Math.floor(rng() * 6) }, () => makeSong(nextId++)),
        rng() < 0.5,
        undefined,
        rng,
      );
      invariants(state, `seed ${seed} initial`);
      for (let step = 0; step < 40; step++) {
        const op = Math.floor(rng() * 7);
        const label = `seed ${seed} step ${step} op ${op}`;
        const len = state.queueOrder.length;
        const audibleBefore = ops.currentSongOf(state)?.id ?? null;
        switch (op) {
          case 0:
            state = ops.setQueueIndex(state, Math.floor(rng() * Math.max(1, len + 2)) - 1);
            break;
          case 1:
            state = ops.setShuffle(state, rng() < 0.5, rng);
            break;
          case 2:
            state = ops.addToQueue(state, makeSong(nextId++));
            break;
          case 3:
            state = ops.playNext(state, makeSong(nextId++));
            break;
          case 4: {
            const from = Math.floor(rng() * Math.max(1, len));
            const to = Math.floor(rng() * Math.max(1, len));
            const before = ops.currentSongOf(state)?.id ?? null;
            state = ops.reorderQueue(state, from, to);
            // Reorder never changes the audible song.
            expect(ops.currentSongOf(state)?.id ?? null).toBe(before);
            break;
          }
          case 5: {
            const target = Math.floor(rng() * Math.max(1, len));
            const before = ops.currentSongOf(state)?.id ?? null;
            state = ops.removeFromQueue(state, target);
            // Remove never changes the audible song (refuses the current row).
            expect(ops.currentSongOf(state)?.id ?? null).toBe(before);
            break;
          }
          case 6:
            state = ops.setQueue(
              Array.from({ length: Math.floor(rng() * 5) }, () => makeSong(nextId++)),
              rng() < 0.5,
              undefined,
              rng,
            );
            break;
        }
        void audibleBefore;
        invariants(state, label);
      }
    }
  });
});

describe("setQueue", () => {
  it("identity order and index 0 without shuffle", () => {
    const state = ops.setQueue([makeSong(1), makeSong(2), makeSong(3)], false);
    expect(state.queueOrder).toEqual([0, 1, 2]);
    expect(state.queueIndex).toBe(0);
  });

  it("startIndex picks the natural position without shuffle", () => {
    const state = ops.setQueue([makeSong(1), makeSong(2), makeSong(3)], false, 2);
    expect(state.queueIndex).toBe(2);
    expect(ops.currentSongOf(state)?.id).toBe(3);
  });

  it("startIndex moves the song to the front of a shuffled order", () => {
    const rng = mulberry32(7);
    const state = ops.setQueue([makeSong(1), makeSong(2), makeSong(3), makeSong(4)], true, 2, rng);
    expect(state.queueIndex).toBe(0);
    expect(state.queueOrder[0]).toBe(2);
    expect(ops.currentSongOf(state)?.id).toBe(3);
    expect(ops.isPermutation(state.queueOrder, 4)).toBe(true);
  });
});

describe("setShuffle (the only reshuffle point)", () => {
  it("ON keeps the current song first; OFF returns to natural position", () => {
    const rng = mulberry32(3);
    let state = ops.setQueue([makeSong(1), makeSong(2), makeSong(3), makeSong(4)], false);
    state = ops.setQueueIndex(state, 2);
    const current = ops.currentSongOf(state)?.id;
    state = ops.setShuffle(state, true, rng);
    expect(state.queueIndex).toBe(0);
    expect(ops.currentSongOf(state)?.id).toBe(current);
    state = ops.setShuffle(state, false, rng);
    expect(state.queueOrder).toEqual([0, 1, 2, 3]);
    expect(state.queueIndex).toBe(2);
    expect(ops.currentSongOf(state)?.id).toBe(current);
  });

  it("same-value toggle is a no-op", () => {
    const state = ops.setQueue([makeSong(1), makeSong(2)], false);
    expect(ops.setShuffle(state, false)).toBe(state);
  });
});

describe("playNext / addToQueue", () => {
  it("playNext splices right after the cursor; addToQueue appends", () => {
    let state = ops.setQueue([makeSong(1), makeSong(2), makeSong(3)], false);
    state = ops.setQueueIndex(state, 1);
    state = ops.playNext(state, makeSong(9));
    expect(state.queueOrder).toEqual([0, 1, 3, 2]);
    state = ops.addToQueue(state, makeSong(10));
    expect(state.queueOrder).toEqual([0, 1, 3, 2, 4]);
    expect(state.queue.map((s) => s.id)).toEqual([1, 2, 3, 9, 10]);
  });
});

describe("reorderQueue cursor fixups", () => {
  const base = (): QueueState => {
    let s = ops.setQueue([makeSong(1), makeSong(2), makeSong(3), makeSong(4)], false);
    s = ops.setQueueIndex(s, 2);
    return s;
  };

  it("moving the current row: index follows", () => {
    const s = ops.reorderQueue(base(), 2, 0);
    expect(s.queueIndex).toBe(0);
    expect(ops.currentSongOf(s)?.id).toBe(3);
  });

  it("moving from before to at/after the cursor: index - 1", () => {
    const s = ops.reorderQueue(base(), 0, 3);
    expect(s.queueIndex).toBe(1);
    expect(ops.currentSongOf(s)?.id).toBe(3);
  });

  it("moving from after to at/before the cursor: index + 1", () => {
    const s = ops.reorderQueue(base(), 3, 0);
    expect(s.queueIndex).toBe(3);
    expect(ops.currentSongOf(s)?.id).toBe(3);
  });
});

describe("removeFromQueue", () => {
  it("refuses the current row", () => {
    let s = ops.setQueue([makeSong(1), makeSong(2)], false);
    s = ops.setQueueIndex(s, 1);
    expect(ops.removeFromQueue(s, 1)).toBe(s);
  });

  it("remaps order entries above the removed backing index", () => {
    let s = ops.setQueue([makeSong(1), makeSong(2), makeSong(3)], false);
    s = { ...s, queueOrder: [2, 0, 1], queueIndex: 1 }; // visible: 3,1,2 - current 1
    const r = ops.removeFromQueue(s, 0); // remove visible row "3" (backing 2)
    expect(r.queue.map((x) => x.id)).toEqual([1, 2]);
    expect(r.queueOrder).toEqual([0, 1]);
    expect(r.queueIndex).toBe(0);
    expect(ops.currentSongOf(r)?.id).toBe(1);
  });
});

describe("sanitizeSnapshot (every adoption)", () => {
  it("drops jam proposals with order/index remap", () => {
    const songs = [makeSong(1), makeSong(2, { jam_song: true }), makeSong(3)];
    const s = ops.sanitizeSnapshot(songs, [0, 1, 2], 2, false);
    expect(s.queue.map((x) => x.id)).toEqual([1, 3]);
    expect(s.queueOrder).toEqual([0, 1]);
    // Two kept entries before position 2 -> index lands on song 3.
    expect(ops.currentSongOf(s)?.id).toBe(3);
  });

  it("index on a dropped proposal lands on the next surviving song", () => {
    const songs = [makeSong(1), makeSong(2, { jam_song: true }), makeSong(3)];
    const s = ops.sanitizeSnapshot(songs, [0, 1, 2], 1, false);
    expect(ops.currentSongOf(s)?.id).toBe(3);
  });

  it("a non-permutation order falls back to identity with a clamped index", () => {
    const songs = [makeSong(1), makeSong(2)];
    const s = ops.sanitizeSnapshot(songs, [0, 0], 7, true);
    expect(s.queueOrder).toEqual([0, 1]);
    expect(s.queueIndex).toBe(1);
    expect(s.shuffle).toBe(true);
  });

  it("garbage shapes produce an empty valid state", () => {
    const s = ops.sanitizeSnapshot("nope", null, "x", undefined);
    expect(s.queue).toEqual([]);
    expect(s.queueOrder).toEqual([]);
    expect(s.queueIndex).toBe(0);
  });
});

describe("insertJamProposal (FIFO behind earlier proposals)", () => {
  it("lands after the current song but behind waiting proposals", () => {
    let s = ops.setQueue([makeSong(1), makeSong(2)], false);
    s = ops.insertJamProposal(s, makeSong(90, { jam_song: true }));
    s = ops.insertJamProposal(s, makeSong(91, { jam_song: true }));
    const visible = s.queueOrder.map((i) => s.queue[i]!.id);
    expect(visible).toEqual([1, 90, 91, 2]);
  });
});

describe("nextIndex / previousIndex (FR-58)", () => {
  it("next wraps under All, clamps otherwise, restarts single-song queues", () => {
    let s = ops.setQueue([makeSong(1), makeSong(2)], false);
    s = ops.setQueueIndex(s, 1);
    expect(ops.nextIndex(s, "all")).toEqual({ index: 0, restart: false });
    expect(ops.nextIndex(s, "none")).toBeNull(); // clamped onto itself: no-op
    const single = ops.setQueue([makeSong(1)], false);
    expect(ops.nextIndex(single, "all")).toEqual({ index: 0, restart: true });
    expect(ops.nextIndex(single, "none")).toBeNull();
  });

  it("previous restarts past 3 s, on the first entry under None, and on wrap-to-self", () => {
    let s = ops.setQueue([makeSong(1), makeSong(2)], false);
    expect(ops.previousIndex(s, "none", 10)).toEqual({ restart: true });
    expect(ops.previousIndex(s, "none", 1)).toEqual({ restart: true });
    expect(ops.previousIndex(s, "all", 1)).toEqual({ restart: false, index: 1 });
    s = ops.setQueueIndex(s, 1);
    expect(ops.previousIndex(s, "none", 1)).toEqual({ restart: false, index: 0 });
    const single = ops.setQueue([makeSong(1)], false);
    expect(ops.previousIndex(single, "all", 0)).toEqual({ restart: true });
  });
});
