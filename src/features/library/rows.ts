/**
 * Library row assembly (FR-35), pure so the filter and badge rules are
 * unit-testable. Rows carry their own artwork chain result, so a row with
 * no cover falls through to the ONE shared placeholder photo like every
 * other surface (FR-21) - never a letter tile.
 */
import type { Href } from "expo-router";
import type { AlbumSummary } from "@/domain/album";
import { artistDisplayName, artistRouteSegment } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import {
  artistImageSource,
  playlistArtworkSource,
  type ArtworkSource,
} from "@/domain/artwork";
import type { Playlist } from "@/domain/playlist";
import { isSystemPlaylist } from "@/domain/playlist";
import { albumRoute, artistRoute, playlistRoute } from "@/lib/routes";

export type LibraryFilter = "all" | "playlists" | "artists" | "albums";

export interface LibraryRow {
  key: string;
  kind: "playlist" | "artist" | "album";
  name: string;
  subtitle: string;
  artwork: ArtworkSource;
  route: Href;
  /** Spotify-synced playlist: draws the emerald badge, never an edit affordance. */
  system: boolean;
  circular: boolean;
  /** The pinned Liked Songs entry: bold name, immune to the filter pills. */
  pinned?: boolean;
}

export interface LibraryRowLabels {
  playlistKind: string;
  artistKind: string;
  albumKind: string;
  spotify: string;
}

export interface LibrarySources {
  playlists: Playlist[];
  artists: Artist[];
  albums: AlbumSummary[];
}

const wants = (filter: LibraryFilter, kind: Exclude<LibraryFilter, "all">): boolean =>
  filter === "all" || filter === kind;

/** The local search predicate: name OR subtitle, case-insensitive. */
export const rowMatchesSearch = (row: LibraryRow, search: string): boolean => {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    row.name.toLowerCase().includes(trimmed) || row.subtitle.toLowerCase().includes(trimmed)
  );
};

/**
 * The pinned Liked Songs row (owner request 2026-08-14): sits ABOVE the
 * assembled rows on both library surfaces no matter which pill is active -
 * liked songs are the one collection every account owns, so no filter may
 * hide it. Deliberately NOT part of buildLibraryRows: pills must never
 * filter it, so callers prepend it themselves (gated only by the search
 * text, through rowMatchesSearch like any other row).
 */
export const likedLibraryRow = (name: string, kindLabel: string): LibraryRow => ({
  key: "liked",
  kind: "playlist",
  name,
  subtitle: kindLabel,
  artwork: { kind: "likedHeart" },
  route: "/(main)/liked",
  system: false,
  circular: false,
  pinned: true,
});

export const buildLibraryRows = (
  filter: LibraryFilter,
  sources: LibrarySources,
  search: string,
  labels: LibraryRowLabels,
): LibraryRow[] => {
  const out: LibraryRow[] = [];

  if (wants(filter, "playlists")) {
    for (const playlist of sources.playlists) {
      const system = isSystemPlaylist(playlist);
      out.push({
        key: `playlist-${playlist.id}`,
        kind: "playlist",
        name: playlist.name,
        subtitle: system
          ? `${labels.playlistKind} • ${labels.spotify}`
          : labels.playlistKind,
        artwork: playlistArtworkSource(playlist),
        route: playlistRoute(playlist.id),
        system,
        circular: false,
      });
    }
  }

  if (wants(filter, "artists")) {
    for (const artist of sources.artists) {
      if (!artist?.name) continue;
      out.push({
        key: `artist-${artist.id}`,
        kind: "artist",
        name: artist.name,
        subtitle: labels.artistKind,
        artwork: artistImageSource(artist, "sm"),
        route: artistRoute(artist.slug || artist.name),
        system: false,
        circular: true,
      });
    }
  }

  if (wants(filter, "albums")) {
    for (const album of sources.albums) {
      if (!album.name) continue;
      const artistName = artistDisplayName(album.artist);
      const segment = album.artist_slug ?? artistRouteSegment(album.artist) ?? "null";
      out.push({
        key: `album-${segment}-${album.name}`,
        kind: "album",
        name: album.name,
        subtitle: artistName ? `${labels.albumKind} • ${artistName}` : labels.albumKind,
        artwork: album.artwork_media_id
          ? { kind: "node", nodeId: album.artwork_media_id }
          : { kind: "placeholder" },
        route: albumRoute(segment, album.name),
        system: false,
        circular: false,
      });
    }
  }

  if (!search.trim()) return out;
  return out.filter((row) => rowMatchesSearch(row, search));
};
