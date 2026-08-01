/**
 * Library-tab list queries (FR-35). WP1's query modules cover the search
 * and collection shapes; the library needs the two flat "everything at the
 * 500-row ceiling" reads that have no hook there, so they are assembled
 * here from the same WP1 primitives (guardedQueryFn + the key namespace +
 * the offline-fallback wrapper) rather than by touching shared files.
 *
 * Each query is gated by its pill: picking "Playlists" must not pull the
 * whole artist and album lists in the background.
 */
import { useQuery } from "@tanstack/react-query";
import { listArtists } from "@/api/endpoints/artists";
import { listAlbums } from "@/api/endpoints/songs";
import { pageModifier } from "@/api/params";
import { guardedQueryFn } from "@/api/queries/common";
import { keys } from "@/api/queryKeys";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";

/** The backend clamps every listing at 500 rows: this is the real ceiling. */
export const LIBRARY_ITEM_LIMIT = 500;

const listArtistsWithFallback = withOfflineFallback(listArtists, "artists");
const listAlbumsWithFallback = withOfflineFallback(listAlbums, "albums");

const LIBRARY_ARTISTS_FILTERS = {
  modifiers: { page: pageModifier(1, LIBRARY_ITEM_LIMIT), order: "name:asc" },
} as const;

const LIBRARY_ALBUMS_FILTERS = {
  modifiers: { page: pageModifier(1, LIBRARY_ITEM_LIMIT) },
} as const;

/** Whole roster, name:asc (FR-35). */
export const useLibraryArtists = (enabled: boolean) => {
  const authReady = useAuthReady();
  const key = keys.artists.list({ page: LIBRARY_ITEM_LIMIT, order: "name:asc" });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listArtistsWithFallback(LIBRARY_ARTISTS_FILTERS)),
    enabled: authReady && enabled,
  });
};

/** Album summaries from /songs/albums (FR-35). */
export const useLibraryAlbums = (enabled: boolean) => {
  const authReady = useAuthReady();
  const key = keys.albums.list({ page: LIBRARY_ITEM_LIMIT });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listAlbumsWithFallback(LIBRARY_ALBUMS_FILTERS)),
    enabled: authReady && enabled,
  });
};
