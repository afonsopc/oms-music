/**
 * Library row assembly (FR-35), pure so the filter and badge rules are
 * unit-testable. Rows carry their own artwork chain result, so a row with
 * no cover falls through to the ONE shared placeholder photo like every
 * other surface (FR-21) - never a letter tile.
 */
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

export type LibraryFilter = "all" | "playlists" | "artists" | "albums";

export interface LibraryRow {
  key: string;
  kind: "playlist" | "artist" | "album";
  name: string;
  subtitle: string;
  artwork: ArtworkSource;
  route: string;
  /** Spotify-synced playlist: draws the emerald badge, never an edit affordance. */
  system: boolean;
  circular: boolean;
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
        route: `/(main)/playlist/${playlist.id}`,
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
        route: `/(main)/artist/${artist.slug || encodeURIComponent(artist.name)}`,
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
        artwork: album.artwork_fs_node_id
          ? { kind: "node", nodeId: album.artwork_fs_node_id }
          : { kind: "placeholder" },
        route: `/(main)/album/${segment}/${encodeURIComponent(album.name)}`,
        system: false,
        circular: false,
      });
    }
  }

  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return out;
  return out.filter(
    (row) =>
      row.name.toLowerCase().includes(trimmed) ||
      row.subtitle.toLowerCase().includes(trimmed),
  );
};
