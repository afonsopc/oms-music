import type { FsNodeId } from "./ids";
import type { Artist } from "./artist";

/**
 * NOT a server entity; the /songs/albums summary row. `artist` may be a full
 * Artist object (current backend) OR a bare string (legacy rows).
 */
export interface AlbumSummary {
  name: string | null; // null = unknown album
  artist: Artist | string | null;
  artist_slug: string | null;
  artwork_fs_node_id: FsNodeId | null;
}

/** play_events recent/top rows share the polymorphic artist shape. */
export const artistDisplayName = (artist: Artist | string | null | undefined): string | null => {
  if (!artist) return null;
  return typeof artist === "string" ? artist : artist.name;
};

/** Route segment for a polymorphic artist: slug when we have one, else the encoded name. */
export const artistRouteSegment = (artist: Artist | string | null | undefined): string | null => {
  if (!artist) return null;
  if (typeof artist === "string") return encodeURIComponent(artist);
  return artist.slug || encodeURIComponent(artist.name);
};
