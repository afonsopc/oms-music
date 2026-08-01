/**
 * FR-30/FR-33 acceptance: the backend LIKE-matches and returns rows
 * alphabetically, so every search list is re-ranked client-side. "carlos"
 * must surface "Carlos Paiao" above alphabetically-earlier weak matches,
 * and the top-result priority must follow the web exactly.
 */
import { describe, expect, it } from "bun:test";
import type { AlbumSummary } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import type { Playlist } from "@/domain/playlist";
import type { Song, SongArtistEntry } from "@/domain/song";
import {
  buildSuggestions,
  deriveArtistEntries,
  pickTopResult,
  toAlbumHits,
} from "../results";

const artist = (id: number, name: string, slug?: string): Artist =>
  ({ id, name, slug: slug ?? "", songs_count: 0 }) as unknown as Artist;

const songArtist = (name: string, slug: string): SongArtistEntry =>
  ({ name, slug, role: "primary", position: 0 }) as unknown as SongArtistEntry;

const song = (id: number, title: string, artists: SongArtistEntry[] = []): Song =>
  ({ id, title, album: null, duration: 100, artists }) as unknown as Song;

const album = (
  name: string | null,
  artistValue: AlbumSummary["artist"] = null,
  slug: string | null = null,
): AlbumSummary => ({
  name,
  artist: artistValue,
  artist_slug: slug,
  artwork_fs_node_id: null,
});

const playlist = (id: number, name: string): Playlist =>
  ({ id, name, source_kind: "manual" }) as unknown as Playlist;

describe("toAlbumHits", () => {
  it("drops nameless rows and ranks the rest", () => {
    const hits = toAlbumHits(
      [album(null), album("Agrupamento Carlos"), album("Carlos ao Vivo")],
      "carlos",
    );
    expect(hits).toHaveLength(2);
    expect(hits[0].name).toBe("Carlos ao Vivo");
  });

  it("prefers artist_slug over the polymorphic artist for the route segment", () => {
    const [hit] = toAlbumHits([album("Album", "Carlos Paiao", "carlos-paiao")], "album");
    expect(hit.artistSegment).toBe("carlos-paiao");
    expect(hit.artist).toBe("Carlos Paiao");
  });

  // Segments stay RAW; lib/routes.ts hands them to the router, which encodes.
  it("keeps a bare-string artist unencoded in the route segment", () => {
    const [hit] = toAlbumHits([album("Album", "Rui Veloso")], "album");
    expect(hit.artistSegment).toBe("Rui Veloso");
  });
});

describe("deriveArtistEntries", () => {
  it("ranks a strong match above alphabetically-earlier weak ones", () => {
    const entries = deriveArtistEntries(
      [artist(1, "Agrupamento Escolas D. Carlos I"), artist(2, "Carlos Paiao", "carlos-paiao")],
      [],
      [],
      "carlos",
    );
    expect(entries[0].name).toBe("Carlos Paiao");
    expect(entries[0].segment).toBe("carlos-paiao");
  });

  it("harvests song and album artists, deduped case-insensitively", () => {
    const entries = deriveArtistEntries(
      [artist(1, "Carlos Paiao", "carlos-paiao")],
      [song(1, "Playback", [songArtist("CARLOS PAIAO", "carlos-paiao")])],
      toAlbumHits([album("Best of", "Carlos Mendes")], "carlos"),
      "carlos",
    );
    expect(entries.map((e) => e.name)).toEqual(["Carlos Paiao", "Carlos Mendes"]);
  });

  it("keeps the roster resource on direct hits only", () => {
    const entries = deriveArtistEntries(
      [artist(1, "Xutos", "xutos")],
      [song(1, "Song", [songArtist("Ala dos Namorados", "ala")])],
      [],
      "",
    );
    expect(entries[0].artist).toBeTruthy();
    expect(entries[1].artist).toBeUndefined();
    expect(entries[1].segment).toBe("ala");
  });

  it("falls back to artist_names when a song carries no artist rows", () => {
    const legacy = { ...song(1, "Song"), artist_names: ["Legacy Name"] } as Song;
    const entries = deriveArtistEntries([], [legacy], [], "");
    expect(entries[0].name).toBe("Legacy Name");
    expect(entries[0].segment).toBe("Legacy Name");
  });
});

describe("pickTopResult", () => {
  const lists = {
    songs: [song(1, "Cinderela")],
    directArtists: [artist(1, "Carlos Paiao", "carlos-paiao")],
    artists: [
      { name: "Carlos Paiao", segment: "carlos-paiao", artist: artist(1, "Carlos Paiao") },
    ],
    albums: toAlbumHits([album("Playback")], ""),
    playlists: [playlist(7, "Festa")],
  };

  it("lets a direct artist hit beat the first song", () => {
    const top = pickTopResult("all", lists);
    expect(top?.kind).toBe("artist");
  });

  it("honors an active kind filter first", () => {
    expect(pickTopResult("songs", lists)?.kind).toBe("song");
    expect(pickTopResult("albums", lists)?.kind).toBe("album");
    expect(pickTopResult("playlists", lists)?.kind).toBe("playlist");
  });

  it("falls back song > album > playlist when no artist matched", () => {
    const noArtists = { ...lists, directArtists: [], artists: [] };
    expect(pickTopResult("all", noArtists)?.kind).toBe("song");
    expect(pickTopResult("all", { ...noArtists, songs: [] })?.kind).toBe("album");
    expect(pickTopResult("all", { ...noArtists, songs: [], albums: [] })?.kind).toBe(
      "playlist",
    );
  });

  it("uses a derived artist only as the last resort", () => {
    const derivedOnly = {
      songs: [],
      directArtists: [],
      artists: [{ name: "Derived", segment: "Derived" }],
      albums: [],
      playlists: [],
    };
    const top = pickTopResult("all", derivedOnly);
    expect(top?.kind).toBe("artist");
    expect(top?.kind === "artist" && top.entry.artist).toBeUndefined();
  });

  it("returns null with nothing to show", () => {
    expect(
      pickTopResult("all", {
        songs: [],
        directArtists: [],
        artists: [],
        albums: [],
        playlists: [],
      }),
    ).toBeNull();
  });
});

describe("buildSuggestions", () => {
  it("caps at 3 per kind and orders songs, artists, albums, playlists", () => {
    const suggestions = buildSuggestions({
      songs: [song(1, "a"), song(2, "b"), song(3, "c"), song(4, "d")],
      directArtists: [artist(1, "A"), artist(2, "B")],
      albums: toAlbumHits([album("One"), album("Two")], ""),
      playlists: [playlist(1, "P")],
    });
    expect(suggestions.map((s) => s.kind)).toEqual([
      "song",
      "song",
      "song",
      "artist",
      "artist",
      "album",
      "album",
      "playlist",
    ]);
  });
});
