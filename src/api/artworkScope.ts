/**
 * Which covers a home open should warm, as a PURE selector.
 *
 * Split out of artworkPrefetch.ts on purpose: that module pulls expo-image and
 * react-native, and the thing most worth testing here has no business touching
 * either. Getting this list wrong is either wasted bytes or a cold grid, and
 * both fail silently, so it gets its own test file.
 */
import type { MediaId } from "@/domain/ids";
import type { MixSummary } from "@/domain/mixes";
import type { Playlist } from "@/domain/playlist";
import type { RecentCollection } from "@/lib/recentCollections";
import type { RecentlyPlayedAlbum } from "./endpoints/playEvents";

/** Home open warms at most this many covers. Roughly two screens of tiles. */
export const MAX_HOME_ARTWORK = 32;

export interface ArtworkScopeInput {
  playlists?: readonly Pick<Playlist, "artwork_media_id">[] | null;
  recentAlbums?: readonly Pick<RecentlyPlayedAlbum, "artwork_media_id">[] | null;
  mixes?: readonly Pick<MixSummary, "artist">[] | null;
  recentCollections?: readonly Pick<RecentCollection, "artworkNodeId">[] | null;
}

/**
 * The exact id list a home open should warm, in tap-likelihood order: the
 * playlist rail, the recently played albums, the mixes rail (whose tiles
 * render the seed artist's photo, never a cover of their own) and the local
 * quick grid of recently played collections.
 *
 * Deduped, nulls and empty strings dropped, capped at `limit`. The cap is
 * applied while building, not after, so the ORDER decides what survives it -
 * a user with 200 playlists warms the first 32 of them, not a random 32.
 */
export const artworkScope = (
  input: ArtworkScopeInput,
  limit: number = MAX_HOME_ARTWORK,
): MediaId[] => {
  const out: MediaId[] = [];
  const seen = new Set<MediaId>();

  const push = (id: MediaId | null | undefined): void => {
    if (!id || seen.has(id) || out.length >= limit) return;
    seen.add(id);
    out.push(id);
  };

  for (const playlist of input.playlists ?? []) push(playlist.artwork_media_id);
  for (const album of input.recentAlbums ?? []) push(album.artwork_media_id);
  for (const mix of input.mixes ?? []) {
    // Compressed first, exactly like the artist image chain everywhere else.
    push(mix.artist?.compressed_image_media_id ?? mix.artist?.image_media_id ?? null);
  }
  for (const recent of input.recentCollections ?? []) push(recent.artworkNodeId);

  return out;
};
