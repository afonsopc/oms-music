import { describe, expect, it } from "bun:test";
import {
  albumYear,
  formatAlbumDuration,
  majorityPrimaryArtist,
  narrowToContextArtist,
} from "../albumDerive";
import type { ArtistId } from "@/domain/ids";
import type { Song, SongArtistEntry } from "@/domain/song";

const entry = (
  artistId: number,
  role: SongArtistEntry["role"],
  name = `artist-${artistId}`,
): SongArtistEntry => ({
  id: artistId * 1000, // join-row id, deliberately different from artist_id
  song_id: 0,
  artist_id: artistId,
  position: 0,
  role,
  name,
  slug: name,
  image_media_id: null,
  compressed_image_media_id: null,
  picture: null,
  picture_medium: null,
  external_image_url: null,
  created_at: "",
  updated_at: "",
});

const song = (id: number, artists: SongArtistEntry[], year: number | null = null): Song =>
  ({
    id,
    title: `song-${id}`,
    album: "Album",
    duration: 100,
    year,
    artists,
  }) as unknown as Song;

describe("narrowToContextArtist", () => {
  it("returns every match when there is no context artist", () => {
    const songs = [song(1, [entry(7, "primary")]), song(2, [entry(9, "primary")])];
    expect(narrowToContextArtist(songs, null).map((s) => s.id)).toEqual([1, 2]);
  });

  it("narrows by artist_id, not by the join-row id", () => {
    const songs = [song(1, [entry(7, "primary")]), song(2, [entry(9, "primary")])];
    // 7000 is the join-row id of the first entry: matching on it must fail.
    expect(narrowToContextArtist(songs, 7000 as ArtistId).map((s) => s.id)).toEqual([1, 2]);
    expect(narrowToContextArtist(songs, 7 as ArtistId).map((s) => s.id)).toEqual([1]);
  });

  it("matches any role, not just primary", () => {
    const songs = [song(1, [entry(7, "primary"), entry(9, "featured")]), song(2, [entry(7, "primary")])];
    expect(narrowToContextArtist(songs, 9 as ArtistId).map((s) => s.id)).toEqual([1]);
  });

  it("falls back to all matches when the context artist has none", () => {
    const songs = [song(1, [entry(7, "primary")]), song(2, [entry(7, "primary")])];
    expect(narrowToContextArtist(songs, 42 as ArtistId).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("majorityPrimaryArtist", () => {
  it("wins by count, not by first appearance", () => {
    const songs = [
      song(1, [entry(9, "primary", "guest")]),
      song(2, [entry(7, "primary", "owner")]),
      song(3, [entry(7, "primary", "owner")]),
    ];
    expect(majorityPrimaryArtist(songs)?.artistId).toBe(7);
    expect(majorityPrimaryArtist(songs)?.name).toBe("owner");
  });

  it("ignores featured credits", () => {
    const songs = [song(1, [entry(9, "featured"), entry(7, "primary")])];
    expect(majorityPrimaryArtist(songs)?.artistId).toBe(7);
  });

  it("returns null when nothing is credited", () => {
    expect(majorityPrimaryArtist([song(1, [])])).toBeNull();
    expect(majorityPrimaryArtist([])).toBeNull();
  });
});

describe("albumYear", () => {
  it("takes the first song carrying a year", () => {
    expect(albumYear([song(1, [], null), song(2, [], 1981)])).toBe(1981);
    expect(albumYear([song(1, [], null)])).toBeNull();
  });
});

describe("formatAlbumDuration", () => {
  it('formats as "M min Ss"', () => {
    expect(formatAlbumDuration(125)).toBe("2 min 5s");
    expect(formatAlbumDuration(0)).toBe("0 min 0s");
    expect(formatAlbumDuration(-5)).toBe("0 min 0s");
  });
});
