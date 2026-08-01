/**
 * FR-35 row assembly: pills decide which kinds are built, the local filter
 * matches name OR subtitle, system playlists are flagged (Spotify marker,
 * never an edit affordance) and the liked mirror always draws the purple
 * heart artwork instead of any stored cover.
 */
import { describe, expect, it } from "bun:test";
import type { AlbumSummary } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import type { Playlist } from "@/domain/playlist";
import { buildLibraryRows, type LibrarySources } from "../rows";

const labels = {
  playlistKind: "Playlist",
  artistKind: "Artist",
  albumKind: "Album",
  spotify: "Spotify",
};

const playlist = (id: number, name: string, extra: Partial<Playlist> = {}): Playlist =>
  ({ id, name, source_kind: "manual", source_external_id: null, ...extra }) as Playlist;

const artist = (id: number, name: string, slug = ""): Artist =>
  ({ id, name, slug }) as unknown as Artist;

const album = (name: string | null, artistValue: AlbumSummary["artist"] = null): AlbumSummary => ({
  name,
  artist: artistValue,
  artist_slug: null,
  artwork_fs_node_id: null,
});

const sources: LibrarySources = {
  playlists: [
    playlist(1, "Road trip"),
    playlist(2, "From Spotify", { source_kind: "spotify_sync" }),
    playlist(3, "Liked", { source_kind: "spotify_sync", source_external_id: "liked" }),
  ],
  artists: [artist(10, "Xutos & Pontapes", "xutos-pontapes"), artist(11, "Rui Veloso")],
  albums: [album("Circo de Feras", "Xutos & Pontapes"), album(null)],
};

describe("buildLibraryRows", () => {
  it("builds only the kinds the active pill asks for", () => {
    expect(buildLibraryRows("playlists", sources, "", labels)).toHaveLength(3);
    expect(buildLibraryRows("artists", sources, "", labels)).toHaveLength(2);
    // The nameless album row is dropped.
    expect(buildLibraryRows("albums", sources, "", labels)).toHaveLength(1);
    expect(buildLibraryRows("all", sources, "", labels)).toHaveLength(6);
  });

  it("flags system playlists and labels them with the Spotify subtitle", () => {
    const rows = buildLibraryRows("playlists", sources, "", labels);
    expect(rows[0].system).toBeFalsy();
    expect(rows[1].system).toBeTruthy();
    expect(rows[1].subtitle).toBe("Playlist • Spotify");
  });

  it("draws the purple heart for the Spotify liked mirror", () => {
    const rows = buildLibraryRows("playlists", sources, "", labels);
    expect(rows[2].artwork.kind).toBe("likedHeart");
  });

  it("routes artists by slug and falls back to the encoded name", () => {
    const rows = buildLibraryRows("artists", sources, "", labels);
    expect(rows[0].route).toBe("/(main)/artist/xutos-pontapes");
    expect(rows[1].route).toBe("/(main)/artist/Rui%20Veloso");
    expect(rows[0].circular).toBeTruthy();
  });

  it("filters locally on name or subtitle, case-insensitively", () => {
    expect(buildLibraryRows("all", sources, "veloso", labels)).toHaveLength(1);
    // Subtitle match: the album row carries its artist in the subtitle.
    const byArtist = buildLibraryRows("albums", sources, "xutos", labels);
    expect(byArtist).toHaveLength(1);
    expect(byArtist[0].name).toBe("Circo de Feras");
    expect(buildLibraryRows("all", sources, "nothing here", labels)).toHaveLength(0);
  });
});
