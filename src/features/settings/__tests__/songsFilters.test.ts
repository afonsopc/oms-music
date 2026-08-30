import { describe, expect, it } from "bun:test";
import {
  artistParamsFromChips,
  chipsFromSong,
  codecOptions,
  filterSongs,
  mergeLookups,
  originOptions,
  songOriginKey,
  EMPTY_SONG_FILTERS,
} from "../songsFilters";
import type { Song, SongArtistEntry } from "@/domain/song";
import type { SongId } from "@/domain/ids";

const artistEntry = (
  name: string,
  position: number,
  role: SongArtistEntry["role"],
): SongArtistEntry => ({
  id: position,
  song_id: 1,
  artist_id: position,
  position,
  role,
  name,
  slug: name.toLowerCase(),
  image_media_id: null,
  compressed_image_media_id: null,
  picture: null,
  picture_medium: null,
  external_image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const song = (overrides: Partial<Song>): Song =>
  ({
    id: 1 as SongId,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    title: "Song",
    album: null,
    duration: 200,
    position: null,
    year: null,
    audio_media_id: null,
    compressed_audio_media_id: null,
    artwork_media_id: null,
    compressed_artwork_media_id: null,
    vocals_media_id: null,
    instrumental_media_id: null,
    vocal_separation_started_at: null,
    user_id: "u1",
    source_kind: null,
    source_provider: null,
    source_url: null,
    source_id: null,
    isrc: null,
    original_filename: null,
    audio_codec: null,
    audio_bitrate_kbps: null,
    audio_sample_rate_hz: null,
    audio_channels: null,
    audio_lossless: null,
    audio_filesize_bytes: null,
    artists: [],
    ...overrides,
  }) as Song;

describe("artistParamsFromChips (FR-96 request shape)", () => {
  it("ALWAYS includes featuredArtistNames - single empty string when none", () => {
    const params = artistParamsFromChips([
      { name: "Carlos Paiao", role: "primary" },
    ]);
    expect(params.artistNames).toEqual(["Carlos Paiao"]);
    expect(params.featuredArtistNames).toEqual([""]);
    // The key existing is what suppresses the legacy "feat." title reparse.
    expect("featuredArtistNames" in params).toBe(true);
  });

  it("splits primaries and featured in chip order", () => {
    const params = artistParamsFromChips([
      { name: "A", role: "primary" },
      { name: "B", role: "featured" },
      { name: "C", role: "primary" },
      { name: "D", role: "featured" },
    ]);
    expect(params.artistNames).toEqual(["A", "C"]);
    expect(params.featuredArtistNames).toEqual(["B", "D"]);
  });

  it("drops blank names but keeps the featured sentinel", () => {
    const params = artistParamsFromChips([
      { name: "  ", role: "featured" },
      { name: "A", role: "primary" },
    ]);
    expect(params.artistNames).toEqual(["A"]);
    expect(params.featuredArtistNames).toEqual([""]);
  });
});

describe("chipsFromSong", () => {
  it("orders by position and maps with -> featured", () => {
    const s = song({
      artists: [
        artistEntry("B", 2, "with"),
        artistEntry("A", 1, "primary"),
      ],
    });
    expect(chipsFromSong(s)).toEqual([
      { name: "A", role: "primary" },
      { name: "B", role: "featured" },
    ]);
  });

  it("legacy unroled rows: lead becomes primary, rest featured", () => {
    const s = song({
      artists: [
        artistEntry("Lead", 1, "" as SongArtistEntry["role"]),
        artistEntry("Other", 2, "" as SongArtistEntry["role"]),
      ],
    });
    expect(chipsFromSong(s)).toEqual([
      { name: "Lead", role: "primary" },
      { name: "Other", role: "featured" },
    ]);
  });
});

describe("filterSongs", () => {
  const library = [
    song({
      id: 1 as SongId,
      title: "Obedient",
      album: "Icedancer",
      audio_codec: "FLAC",
      audio_lossless: true,
      artists: [artistEntry("Bladee", 1, "primary")],
    }),
    song({
      id: 2 as SongId,
      title: "Playia",
      album: null,
      audio_codec: "aac",
      audio_lossless: false,
      source_kind: "yt_dlp",
      source_provider: "youtube",
      artists: [artistEntry("Carlos Paiao", 1, "primary")],
    }),
  ];

  it("matches title/artist/album substrings case-insensitively", () => {
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, title: "obed" })).toHaveLength(1);
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, artist: "paiao" })).toHaveLength(1);
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, album: "iced" })).toHaveLength(1);
  });

  it("filters origin, quality and codec", () => {
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, origins: ["upload"] })).toHaveLength(1);
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, origins: ["youtube"] })).toHaveLength(1);
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, qualities: ["lossless"] })).toHaveLength(1);
    expect(filterSongs(library, { ...EMPTY_SONG_FILTERS, codecs: ["flac"] })).toHaveLength(1);
  });

  it("builds option lists from present values only", () => {
    expect(originOptions(library)).toEqual(["upload", "youtube"]);
    expect(codecOptions(library)).toEqual(["aac", "flac"]);
    expect(songOriginKey(library[1]!)).toBe("youtube");
  });
});

describe("mergeLookups", () => {
  it("keeps page order and appends unseen lookup rows", () => {
    const a = song({ id: 1 as SongId, title: "A" });
    const b = song({ id: 2 as SongId, title: "B" });
    const c = song({ id: 3 as SongId, title: "C" });
    const merged = mergeLookups([a, b], [b, c]);
    expect(merged.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
