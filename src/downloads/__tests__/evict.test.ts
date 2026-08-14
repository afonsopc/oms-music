/**
 * Eviction ordering and the budget sweep. The ordering is the part that
 * silently eats a user's listening history when it is wrong, so it is tested
 * as a pure function rather than through SQLite.
 */
import { describe, expect, it } from "bun:test";
import type { SongKey } from "@/domain/ids";
import {
  EVICTABLE_BUDGET_CEILING,
  EVICTABLE_BUDGET_FLOOR,
  evictableBudgetFor,
  evictionOrder,
  planEviction,
  type EvictableRow,
} from "../evict";

const row = (
  key: string,
  patch: Partial<EvictableRow> = {},
): EvictableRow => ({
  songKey: key as SongKey,
  kind: "mixed",
  sizeBytes: 1_000,
  predicted: 0,
  updatedAt: 1_000,
  pinned: false,
  ...patch,
});

describe("evictionOrder", () => {
  it("takes probationary rows first, regardless of how fresh they are", () => {
    const rows = [
      row("played-old", { predicted: 0, updatedAt: 1 }),
      row("predicted-new", { predicted: 1, updatedAt: 9_999 }),
    ];
    expect(evictionOrder(rows).map((r) => r.songKey)).toEqual([
      "predicted-new",
      "played-old",
    ]);
  });

  it("is plain LRU within a tier", () => {
    const rows = [
      row("b", { updatedAt: 20 }),
      row("a", { updatedAt: 10 }),
      row("c", { updatedAt: 30 }),
    ];
    expect(evictionOrder(rows).map((r) => r.songKey)).toEqual(["a", "b", "c"]);
    const probation = [
      row("pb", { predicted: 1, updatedAt: 20 }),
      row("pa", { predicted: 1, updatedAt: 10 }),
    ];
    expect(evictionOrder(probation).map((r) => r.songKey)).toEqual(["pa", "pb"]);
  });

  it("never selects a pinned row", () => {
    const rows = [
      row("pinned", { pinned: true, predicted: 1, updatedAt: 0 }),
      row("orphan"),
    ];
    expect(evictionOrder(rows).map((r) => r.songKey)).toEqual(["orphan"]);
  });
});

describe("planEviction", () => {
  it("does nothing when the tier already fits", () => {
    const plan = planEviction([row("a"), row("b")], 10_000);
    expect(plan.evict).toEqual([]);
    expect(plan.bytesFreed).toBe(0);
  });

  it("stops the moment the budget fits", () => {
    // 5 x 1000 bytes, budget 2500 -> drop 3, keep 2.
    const rows = [1, 2, 3, 4, 5].map((n) => row(`s${n}`, { updatedAt: n }));
    const plan = planEviction(rows, 2_500);
    expect(plan.evict.map((r) => r.songKey)).toEqual(["s1", "s2", "s3"]);
    expect(plan.bytesFreed).toBe(3_000);
  });

  it("keeps pinned bytes out of the budget entirely", () => {
    // A user with 3 GB of downloads still gets a working cache: the pinned
    // row is neither counted nor evictable.
    const rows = [
      row("pinned", { pinned: true, sizeBytes: 3_000_000_000 }),
      row("orphan", { sizeBytes: 100 }),
    ];
    expect(planEviction(rows, 1_000).evict).toEqual([]);
  });

  it("survives a budget of zero without touching pinned rows", () => {
    const rows = [row("pinned", { pinned: true }), row("orphan")];
    const plan = planEviction(rows, 0);
    expect(plan.evict.map((r) => r.songKey)).toEqual(["orphan"]);
  });

  it("never evicts a file the player is serving, even at a budget of zero", () => {
    // `purgeEvictable` is a button with no confirmation and it passes 0, so
    // ordering protects nothing: without the keep set it unlinks the file
    // backing the song playing at that moment (an orphan by definition,
    // because it came from the play cache or the predictive tier).
    const rows = [
      row("playing", { predicted: 1, updatedAt: 1 }),
      row("other", { predicted: 1, updatedAt: 2 }),
    ];
    const plan = planEviction(rows, 0, new Set(["playing::mixed"]));
    expect(plan.evict.map((r) => r.songKey)).toEqual(["other"]);
  });

  it("does not credit the kept bytes against the budget", () => {
    // 3 x 1000, budget 1000, one kept: the sweep has to keep going until the
    // rows it MAY delete are gone, not stop as if the kept bytes had left.
    const rows = [
      row("keep", { updatedAt: 1 }),
      row("a", { updatedAt: 2 }),
      row("b", { updatedAt: 3 }),
    ];
    const plan = planEviction(rows, 1_000, new Set(["keep::mixed"]));
    expect(plan.evict.map((r) => r.songKey)).toEqual(["a", "b"]);
  });

  it("attributes freed bytes to the predictive waste counter", () => {
    const rows = [
      row("guess", { predicted: 1, sizeBytes: 700 }),
      row("played", { predicted: 0, sizeBytes: 700 }),
    ];
    const plan = planEviction(rows, 0);
    expect(plan.bytesFreed).toBe(1_400);
    expect(plan.predictedBytesFreed).toBe(700);
  });
});

describe("evictableBudgetFor", () => {
  it("clamps to the floor on a nearly full device", () => {
    expect(evictableBudgetFor(0)).toBe(EVICTABLE_BUDGET_FLOOR);
    expect(evictableBudgetFor(1_000_000)).toBe(EVICTABLE_BUDGET_FLOOR);
  });

  it("clamps to the ceiling on a huge device", () => {
    expect(evictableBudgetFor(512 * 1024 ** 3)).toBe(EVICTABLE_BUDGET_CEILING);
  });

  it("takes a tenth in between", () => {
    const free = 10 * 1024 ** 3; // 10 GiB free -> 1 GiB budget
    expect(evictableBudgetFor(free)).toBe(1024 ** 3);
  });
});
