import { expect, test } from "bun:test";
import { withSongAppended, withoutPendingSong } from "../playlistPages";

const song = (id: number) => ({ id, title: `s${id}` }) as never;
const row = (id: number) => ({ id, song_id: id, position: id, song: song(id) }) as never;
const data = (...pages: unknown[][]) => ({ pages, pageParams: pages.map((_, i) => i + 1) }) as never;

test("a song joins the end at once and leaves again on failure", () => {
  const next = withSongAppended(data([row(1), row(2)]), 9 as never, song(3));
  expect(next.pages[0].map((r) => r.song_id as number)).toEqual([1, 2, 3]);
  expect(next.pages[0][2].id).toBeLessThan(0);
  expect(withoutPendingSong(next, 3 as never).pages[0]).toHaveLength(2);
});

test("not twice, and not when the end is not loaded", () => {
  const one = data([row(1)]);
  expect(withSongAppended(one, 9 as never, song(1))).toBe(one);
  const full = data(Array.from({ length: 100 }, (_, i) => row(i + 1)));
  expect(withSongAppended(full, 9 as never, song(500))).toBe(full);
});
