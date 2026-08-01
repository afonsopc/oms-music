/**
 * Offline library derivations (FR-91): album grouping by the backend's
 * (album, lead artist) key, artist synthesis from song entries, the filter
 * subset the wrapped query fns send, and page windows.
 */
import { describe, expect, it } from "bun:test";
import {
  applyPageWindow,
  deriveOfflineAlbums,
  deriveOfflineArtists,
  filterOfflineSongs,
  matchesArtistIdentity,
  parsePageModifier,
  searchOfflineArtists,
  sortAlbumSongs,
} from "../library";
import type { SongId } from "@/domain/ids";
import type { Song, SongArtistEntry } from "@/domain/song";

const entry = (
  name: string,
  slug: string,
  role: SongArtistEntry["role"],
  position: number,
): SongArtistEntry => ({
  id: position,
  song_id: 0,
  artist_id: name.length,
  position,
  role,
  name,
  slug,
  image_fs_node_id: null,
  compressed_image_fs_node_id: null,
  picture: null,
  picture_medium: null,
  external_image_url: null,
  created_at: "2026-01-0" + position + "T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const song = (
  id: number,
  title: string,
  album: string | null,
  artists: SongArtistEntry[],
  extra: Partial<Song> = {},
): Song => ({
  id: id as SongId,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title,
  album,
  duration: 180,
  position: null,
  year: null,
  audio_fs_node_id: `audio-${id}`,
  compressed_audio_fs_node_id: `caudio-${id}`,
  artwork_fs_node_id: `art-${id}`,
  compressed_artwork_fs_node_id: `cart-${id}`,
  vocals_fs_node_id: null,
  instrumental_fs_node_id: null,
  vocal_separation_started_at: null,
  user_id: "user-1",
  source_kind: null,
  source_provider: null,
  source_url: null,
  source_id: null,
  isrc: null,
  original_filename: null,
  audio_codec: "aac",
  audio_bitrate_kbps: 192,
  audio_sample_rate_hz: 44100,
  audio_channels: 2,
  audio_lossless: false,
  audio_filesize_bytes: 1000,
  artists,
  ...extra,
});

const paiao = entry("Carlos Paião", "carlos-paiao", "primary", 1);
const guest = entry("Guest", "guest", "featured", 2);
const other = entry("Zeca", "zeca", "primary", 1);

const library = (): Song[] => [
  song(1, "Playback", "Singles", [paiao, guest], { position: 2 }),
  song(2, "Ora Vai Tu", "Singles", [paiao], { position: 1 }),
  song(3, "Grandola", null, [other]),
];

describe("filterOfflineSongs", () => {
  it("matches an exact album and treats null as the unknown-album query", () => {
    expect(filterOfflineSongs(library(), { exact_search: { album: "Singles" } })).toHaveLength(2);
    const unknown = filterOfflineSongs(library(), { exact_search: { album: null } });
    expect(unknown.map((s) => s.title)).toEqual(["Grandola"]);
  });

  it("searches titles accent- and case-insensitively", () => {
    const found = filterOfflineSongs(library(), { search: { title: "grandola" } });
    expect(found.map((s) => s.id)).toEqual([3]);
  });

  it("honors artist_role when matching an artist", () => {
    const featured = filterOfflineSongs(library(), {
      exact_search: { artist: "guest" },
      artist_role: "featured",
    });
    expect(featured.map((s) => s.id)).toEqual([1]);
    const asPrimary = filterOfflineSongs(library(), {
      exact_search: { artist: "guest" },
      artist_role: "primary",
    });
    expect(asPrimary).toHaveLength(0);
  });

  it("applies the modifiers page window", () => {
    const page2 = filterOfflineSongs(library(), { modifiers: { page: "2:2" } });
    expect(page2.map((s) => s.id)).toEqual([3]);
  });

  it("ignores filter keys it does not understand instead of emptying the list", () => {
    expect(filterOfflineSongs(library(), { search: { mystery: "x" } })).toHaveLength(3);
  });
});

describe("page windows", () => {
  it("parses N:SIZE and rejects garbage", () => {
    expect(parsePageModifier("3:50")).toEqual({ page: 3, size: 50 });
    expect(parsePageModifier("0:50")).toBeNull();
    expect(parsePageModifier(undefined)).toBeNull();
  });

  it("slices by page", () => {
    expect(applyPageWindow([1, 2, 3, 4, 5], { page: 2, size: 2 })).toEqual([3, 4]);
    expect(applyPageWindow([1, 2, 3], null)).toEqual([1, 2, 3]);
  });
});

describe("deriveOfflineAlbums", () => {
  it("groups by (album, lead artist) and carries the compressed artwork", () => {
    const albums = deriveOfflineAlbums(library());
    expect(albums).toHaveLength(2);
    const singles = albums.find((a) => a.name === "Singles");
    expect(singles?.artist).toBe("Carlos Paião");
    expect(singles?.artist_slug).toBe("carlos-paiao");
    expect(singles?.artwork_fs_node_id).toBe("cart-1");
    expect(albums.some((a) => a.name === null)).toBe(true);
  });

  it("splits the same album name across different lead artists", () => {
    const songs = [
      song(10, "A", "Live", [paiao]),
      song(11, "B", "Live", [other]),
    ];
    expect(deriveOfflineAlbums(songs)).toHaveLength(2);
  });
});

describe("deriveOfflineArtists", () => {
  it("synthesizes one row per primary artist with a song count", () => {
    const artists = deriveOfflineArtists(library());
    expect(artists.map((a) => a.slug)).toEqual(["carlos-paiao", "zeca"]);
    expect(artists[0].songs_count).toBe(2);
    expect(artists[0].name).toBe("Carlos Paião");
  });

  it("leaves featured-only artists out (album grouping parity)", () => {
    expect(deriveOfflineArtists(library()).some((a) => a.slug === "guest")).toBe(false);
  });
});

describe("artist lookup", () => {
  it("identifies an artist by id, slug or full name", () => {
    const artist = deriveOfflineArtists(library())[0];
    expect(matchesArtistIdentity(artist, "carlos-paiao")).toBe(true);
    expect(matchesArtistIdentity(artist, "carlos paiao")).toBe(true);
    expect(matchesArtistIdentity(artist, String(artist.id))).toBe(true);
    expect(matchesArtistIdentity(artist, "carlos")).toBe(false);
  });

  it("searches by substring", () => {
    const artists = deriveOfflineArtists(library());
    expect(searchOfflineArtists(artists, "carl").map((a) => a.slug)).toEqual(["carlos-paiao"]);
    expect(searchOfflineArtists(artists, "")).toHaveLength(2);
  });
});

describe("sortAlbumSongs", () => {
  it("orders by track position, nulls last", () => {
    const ordered = sortAlbumSongs(library());
    expect(ordered.map((s) => s.id)).toEqual([2, 1, 3]);
  });
});
