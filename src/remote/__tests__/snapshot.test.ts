import { describe, expect, it } from "bun:test";
import type { SongId } from "@/domain/ids";
import type { PlaybackSnapshot } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { mergeSlimState, normalizeWireSongId, snapshotCurrentSong } from "../snapshot";
import { computeRole, deviceDisplayLabel } from "../store";
import { interpolatedPosition, tickFromSnapshot, type PositionTick } from "../controller";
import { planOrderMoves } from "../orderPlan";

const song = (id: number): Song =>
  ({ id: id as SongId, title: `Song ${id}`, album: null, duration: 100, artists: [] }) as unknown as Song;

const snapshot = (over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  active_device_id: null,
  song_id: "1",
  position: 12,
  paused: false,
  queue: ["1", "2"],
  queue_index: 0,
  queue_order: [0, 1],
  loop_mode: "all",
  shuffle: false,
  volume: 1,
  queue_songs: [song(1), song(2)],
  ...over,
});

describe("mergeSlimState (FR-109)", () => {
  it("keeps the last full queue_songs when a slim frame omits them", () => {
    const full = snapshot();
    const slim = { ...snapshot({ paused: true }) };
    delete slim.queue_songs;
    const merged = mergeSlimState(slim, full.queue_songs);
    expect(merged.queue_songs).toHaveLength(2);
    expect(merged.paused).toBeTruthy();
  });

  it("treats a present-but-empty array as a full replacement", () => {
    const merged = mergeSlimState(snapshot({ queue_songs: [] }), [song(1)]);
    expect(merged.queue_songs).toHaveLength(0);
  });

  it("falls back to an empty list when nothing was ever received", () => {
    const slim = { ...snapshot() };
    delete slim.queue_songs;
    expect(mergeSlimState(slim, undefined).queue_songs).toHaveLength(0);
  });

  it("never mutates the incoming frame", () => {
    const slim = { ...snapshot() };
    delete slim.queue_songs;
    mergeSlimState(slim, [song(9)]);
    expect(slim.queue_songs).toBeUndefined();
  });
});

describe("snapshotCurrentSong", () => {
  it("resolves through queue_order[queue_index]", () => {
    const s = snapshot({ queue_order: [1, 0], queue_index: 0 });
    expect(snapshotCurrentSong(s)?.id).toBe(2);
  });

  it("returns null for an out-of-range cursor or a missing queue", () => {
    expect(snapshotCurrentSong(snapshot({ queue_order: [], queue_index: 0 }))).toBeNull();
    const slim = { ...snapshot() };
    delete slim.queue_songs;
    expect(snapshotCurrentSong(slim)).toBeNull();
    expect(snapshotCurrentSong(null)).toBeNull();
  });
});

describe("normalizeWireSongId", () => {
  it("stringifies numeric leaks so tick matching cannot silently fail", () => {
    expect(normalizeWireSongId(42)).toBe("42");
    expect(normalizeWireSongId("42")).toBe("42");
    expect(normalizeWireSongId(null)).toBeNull();
    expect(normalizeWireSongId(undefined)).toBeNull();
  });
});

describe("computeRole (FR-107)", () => {
  const base = { snapshot: snapshot(), activeDeviceId: null, yourDeviceId: "s:me" };

  it("is offline until a snapshot arrives", () => {
    expect(computeRole({ ...base, snapshot: null })).toBe("offline");
  });

  it("is no_active when nobody owns audio", () => {
    expect(computeRole(base)).toBe("no_active");
  });

  it("is active only on an exact device-id match", () => {
    expect(computeRole({ ...base, activeDeviceId: "s:me" })).toBe("active");
    expect(computeRole({ ...base, activeDeviceId: "s:other" })).toBe("controller");
    expect(computeRole({ ...base, activeDeviceId: "s:other", yourDeviceId: null })).toBe(
      "controller",
    );
  });
});

describe("deviceDisplayLabel", () => {
  it("prefers the registry label, then description, name, type, fallback", () => {
    const d = { id: "x", label: "", device_type: "mobile", online: true };
    expect(deviceDisplayLabel({ ...d, label: "Pixel - Android" }, "Device")).toBe("Pixel - Android");
    expect(deviceDisplayLabel({ ...d, description: " Studio " }, "Device")).toBe("Studio");
    expect(deviceDisplayLabel({ ...d, name: "Session 3" }, "Device")).toBe("Session 3");
    expect(deviceDisplayLabel(d, "Device")).toBe("mobile");
    expect(deviceDisplayLabel(null, "Device")).toBe("Device");
  });
});

describe("controller interpolation (FR-109 / DESIGN 10.8)", () => {
  const tick = (over: Partial<PositionTick> = {}): PositionTick => ({
    position: 30,
    paused: false,
    songId: "1",
    serverTimeMs: 1_000,
    receivedAtMs: 1_000,
    ...over,
  });

  it("extrapolates a fresh tick by elapsed wall clock", () => {
    expect(interpolatedPosition(tick(), 0, 3_500)).toBe(32.5);
  });

  it("falls back to the snapshot position once the tick is stale", () => {
    expect(interpolatedPosition(tick(), 99, 1_000 + 5_001)).toBe(99);
  });

  it("falls back when there is no tick at all", () => {
    expect(interpolatedPosition(null, 17, 1_000)).toBe(17);
  });

  it("seeds a tick from a snapshot verbatim", () => {
    const seeded = tickFromSnapshot(snapshot({ position: 5, paused: true, song_id: "7" }), 500);
    expect(seeded.position).toBe(5);
    expect(seeded.paused).toBeTruthy();
    expect(seeded.songId).toBe("7");
    expect(seeded.receivedAtMs).toBe(500);
  });
});

describe("planOrderMoves (set_queue_order executor)", () => {
  it("returns no moves for an unchanged order", () => {
    expect(planOrderMoves([0, 1, 2], [0, 1, 2])).toEqual([]);
  });

  it("plans moves that reproduce the target order exactly", () => {
    const current = [3, 0, 2, 1];
    const target = [1, 3, 2, 0];
    const moves = planOrderMoves(current, target);
    expect(moves).not.toBeNull();
    const work = [...current];
    for (const move of moves ?? []) {
      const [value] = work.splice(move.from, 1);
      work.splice(move.to, 0, value);
    }
    expect(work).toEqual(target);
  });

  it("refuses a target that is not a permutation of the current order", () => {
    expect(planOrderMoves([0, 1], [0, 1, 2])).toBeNull();
    expect(planOrderMoves([0, 1], [0, 5])).toBeNull();
  });
});
