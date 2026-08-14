/**
 * The prefetch arbitration. This is the regression net for the one decision
 * the whole feature rests on: when does the next queue track outrank what the
 * user is looking at, and when does it not.
 *
 * Wants are compared through `label()` (rank:kind:songKey:reason) rather than
 * as objects: it reads as the ranked list a human would draw on a whiteboard,
 * and it fails loudly on a rank hole, which is the failure mode that would
 * otherwise pass silently.
 */
import { describe, expect, it } from "bun:test";
import type { SongId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { MAX_ARTWORK_WANTS } from "../constants";
import { computeWants } from "../policy";
import type { PrefetchSignals, PrefetchSong, PrefetchWant } from "../types";

// The policy never reads the back-reference, so a stub identity is enough.
const stubSong = (n: number): Song => ({ id: n as SongId }) as Song;

const song = (n: number, patch: Partial<PrefetchSong> = {}): PrefetchSong => ({
  songKey: String(n) as SongKey,
  audioMediaId: `a${n}`,
  artworkMediaId: `w${n}`,
  jam: false,
  song: stubSong(n),
  ...patch,
});

const rows = (count: number, from = 0): PrefetchSong[] =>
  Array.from({ length: count }, (_, i) => song(from + i));

const signals = (patch: Partial<PrefetchSignals> = {}): PrefetchSignals => ({
  collection: null,
  viewport: { centerIndex: null, first: null, last: null },
  queue: null,
  resident: new Set<string>(),
  ...patch,
});

const label = (w: PrefetchWant): string => `${w.rank}:${w.kind}:${w.songKey}:${w.reason}`;
const labels = (wants: PrefetchWant[]): string[] => wants.map(label);
const audioOf = (wants: PrefetchWant[]): PrefetchWant[] =>
  wants.filter((w) => w.kind === "audio");

describe("computeWants - browse", () => {
  it("wants exactly the first row when a collection opens unscrolled", () => {
    const wants = audioOf(
      computeWants(signals({ collection: { key: "p:1", songs: rows(50) } })),
    );
    expect(labels(wants)).toEqual(["0:audio:0:collection-first"]);
  });

  it("follows the viewport centre once geometry is known", () => {
    const wants = audioOf(
      computeWants(
        signals({
          collection: { key: "p:1", songs: rows(50) },
          viewport: { centerIndex: 37, first: 30, last: 42 },
        }),
      ),
    );
    expect(labels(wants)).toEqual(["0:audio:37:viewport-center"]);
  });
});

describe("computeWants - queue arbitration", () => {
  const queueSignals = (remainingS: number | null, loopOne = false): PrefetchSignals =>
    signals({
      collection: { key: "p:1", songs: rows(50, 100) },
      viewport: { centerIndex: 5, first: 0, last: 10 },
      queue: { songs: rows(3), currentIndex: 1, remainingS, loopOne },
    });

  it("promotes the next track to rank 0 near the end of the current one", () => {
    expect(labels(audioOf(computeWants(queueSignals(20))))).toEqual([
      "0:audio:2:queue-next",
      "1:audio:105:viewport-center",
      "2:audio:0:queue-prev",
    ]);
  });

  it("leaves browse at rank 0 while the track has plenty left", () => {
    expect(labels(audioOf(computeWants(queueSignals(90))))).toEqual([
      "0:audio:105:viewport-center",
      "1:audio:0:queue-prev",
    ]);
  });

  it("emits no next-track want when nothing is playing", () => {
    const wants = audioOf(computeWants(queueSignals(null)));
    expect(wants.some((w) => w.reason === "queue-next")).toBe(false);
  });

  it("suppresses the next-track want entirely under loop-one", () => {
    const wants = audioOf(computeWants(queueSignals(5, true)));
    expect(wants.some((w) => w.reason === "queue-next")).toBe(false);
  });

  it("emits no previous-track want at the head of the queue", () => {
    const wants = audioOf(
      computeWants(
        signals({
          queue: { songs: rows(3), currentIndex: 0, remainingS: 200, loopOne: false },
        }),
      ),
    );
    expect(wants.some((w) => w.reason === "queue-prev")).toBe(false);
  });
});

describe("computeWants - eligibility", () => {
  it("never wants a jam proposal, at any rank", () => {
    const songs = [song(0, { jam: true }), song(1)];
    const wants = computeWants(
      signals({
        collection: { key: "p:1", songs },
        viewport: { centerIndex: 0, first: 0, last: 1 },
      }),
    );
    expect(wants.some((w) => w.songKey === "0")).toBe(false);
  });

  it("skips a row with no media id instead of leaving a rank hole", () => {
    const songs = [song(0, { audioMediaId: null }), song(1)];
    const wants = computeWants(
      signals({
        collection: { key: "p:1", songs },
        queue: { songs, currentIndex: 0, remainingS: 10, loopOne: false },
        viewport: { centerIndex: 0, first: 0, last: 1 },
      }),
    );
    // queue-next (song 1) is eligible and takes rank 0; song 0 has no audio
    // id, so the collection want is dropped and rank 1 goes to the artwork -
    // no hole, because ranks only advance on an ACCEPTED want.
    expect(labels(wants)).toEqual([
      "0:audio:1:queue-next",
      "1:artwork:0:viewport-artwork",
      "2:artwork:1:viewport-artwork",
    ]);
  });

  it("never wants what is already resident or in flight", () => {
    const wants = audioOf(
      computeWants(
        signals({
          collection: { key: "p:1", songs: rows(50) },
          viewport: { centerIndex: 12, first: 10, last: 20 },
          resident: new Set(["12::audio"]),
        }),
      ),
    );
    expect(wants).toHaveLength(0);
  });

  it("dedups a song that is both the next track and the viewport centre", () => {
    const songs = rows(3);
    const wants = audioOf(
      computeWants(
        signals({
          collection: { key: "p:1", songs },
          viewport: { centerIndex: 2, first: 0, last: 2 },
          queue: { songs, currentIndex: 1, remainingS: 10, loopOne: false },
        }),
      ),
    );
    // Song 2 appears ONCE, at the better rank, and the dropped duplicate
    // leaves no hole: queue-prev takes rank 1.
    expect(labels(wants)).toEqual(["0:audio:2:queue-next", "1:audio:0:queue-prev"]);
  });
});

describe("computeWants - caps", () => {
  it("caps artwork at MAX_ARTWORK_WANTS over a huge visible range", () => {
    const wants = computeWants(
      signals({
        collection: { key: "p:1", songs: rows(400) },
        viewport: { centerIndex: 100, first: 0, last: 200 },
      }),
    );
    expect(wants.filter((w) => w.kind === "artwork")).toHaveLength(MAX_ARTWORK_WANTS);
  });

  it("never emits audio for the visible RANGE, only for the centre", () => {
    const wants = audioOf(
      computeWants(
        signals({
          collection: { key: "p:1", songs: rows(400) },
          viewport: { centerIndex: 100, first: 0, last: 200 },
        }),
      ),
    );
    expect(wants).toHaveLength(1);
  });

  it("returns audio first, then artwork, ranks ascending", () => {
    const songs = rows(50);
    const wants = computeWants(
      signals({
        collection: { key: "p:1", songs },
        viewport: { centerIndex: 5, first: 0, last: 8 },
        queue: { songs, currentIndex: 1, remainingS: 10, loopOne: false },
      }),
    );
    const firstArtwork = wants.findIndex((w) => w.kind === "artwork");
    expect(wants.slice(0, firstArtwork).every((w) => w.kind === "audio")).toBe(true);
    expect(wants.every((w, i) => (i === 0 ? true : w.rank > wants[i - 1]!.rank))).toBe(true);
  });
});

describe("computeWants - regression net", () => {
  it("ranks a realistic 50-row playlist with playback mid-track", () => {
    const collection = rows(50, 100);
    const queue = rows(3);
    const wants = computeWants(
      signals({
        collection: { key: "playlist:42", songs: collection },
        viewport: { centerIndex: 16, first: 10, last: 22 },
        queue: { songs: queue, currentIndex: 1, remainingS: 12, loopOne: false },
      }),
    );
    // Three audio wants (queue-next, the centre, queue-prev), then the
    // visible range 10..22 plus ARTWORK_LOOKAHEAD_ROWS = rows 110..134,
    // truncated to the 24-want artwork cap at row 133.
    expect(labels(wants)).toEqual([
      "0:audio:2:queue-next",
      "1:audio:116:viewport-center",
      "2:audio:0:queue-prev",
      ...Array.from(
        { length: MAX_ARTWORK_WANTS },
        (_, i) => `${3 + i}:artwork:${110 + i}:viewport-artwork`,
      ),
    ]);
  });
});
