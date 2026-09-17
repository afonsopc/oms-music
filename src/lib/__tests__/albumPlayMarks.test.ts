import { describe, expect, test } from "bun:test";
import {
  ALBUM_PLAY_MARKS_CAP,
  albumTileKey,
  hiddenByCollectionPlay,
  withAlbumPlayMark,
} from "../albumPlayMarks";

const T0 = Date.parse("2026-09-17T20:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

describe("albumTileKey", () => {
  test("matches the home grid identity, with null placeholders", () => {
    expect(albumTileKey("linkin-park", "Hybrid Theory")).toBe("album:linkin-park::Hybrid Theory");
    expect(albumTileKey(null, undefined)).toBe("album:null::null");
    expect(albumTileKey("", "")).toBe("album:null::null");
  });
});

describe("hiddenByCollectionPlay", () => {
  test("no mark, or a deliberate play, never hides", () => {
    expect(hiddenByCollectionPlay(undefined, iso(T0))).toBe(false);
    expect(hiddenByCollectionPlay({ at: T0, fromCollection: false }, iso(T0))).toBe(false);
  });

  test("a collection play that explains the server's last play hides the album", () => {
    const mark = { at: T0, fromCollection: true };
    expect(hiddenByCollectionPlay(mark, iso(T0 - 20_000))).toBe(true);
    expect(hiddenByCollectionPlay(mark, iso(T0 + 60_000))).toBe(true);
  });

  test("a newer play elsewhere brings the album back", () => {
    const mark = { at: T0, fromCollection: true };
    expect(hiddenByCollectionPlay(mark, iso(T0 + 10 * 60_000))).toBe(false);
  });

  test("garbage timestamps never hide", () => {
    expect(hiddenByCollectionPlay({ at: T0, fromCollection: true }, "not a date")).toBe(false);
  });
});

describe("withAlbumPlayMark", () => {
  test("the newest play rewrites the mark", () => {
    let marks = withAlbumPlayMark({}, "a", true, T0);
    marks = withAlbumPlayMark(marks, "a", false, T0 + 1);
    expect(marks.a).toEqual({ at: T0 + 1, fromCollection: false });
  });

  test("keeps only the most recent CAP entries", () => {
    let marks = withAlbumPlayMark({}, "oldest", true, T0 - 1);
    for (let i = 0; i < ALBUM_PLAY_MARKS_CAP; i++) {
      marks = withAlbumPlayMark(marks, `k${i}`, true, T0 + i);
    }
    expect(Object.keys(marks)).toHaveLength(ALBUM_PLAY_MARKS_CAP);
    expect(marks.oldest).toBeUndefined();
    expect(marks[`k${ALBUM_PLAY_MARKS_CAP - 1}`]).not.toBeUndefined();
  });
});
