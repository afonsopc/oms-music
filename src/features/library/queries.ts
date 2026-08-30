/**
 * Library-tab list queries (FR-35): the two flat "everything" reads the
 * Library pills need, assembled from the shared primitives (guardedQueryFn +
 * the key namespace + the offline-fallback wrapper).
 *
 * Each query is gated by its pill: picking "Playlists" must not pull the
 * whole artist and album lists in the background.
 */
import { useQuery } from "@tanstack/react-query";
import { useAllArtists } from "@/api/queries/artists";
import { guardedQueryFn } from "@/api/queries/common";
import { listAlbums } from "@/api/queries/songs";
import { keys } from "@/api/queryKeys";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";

const listAlbumsWithFallback = withOfflineFallback(listAlbums, "albums");

/** Whole roster, name:asc (FR-35). */
export const useLibraryArtists = (enabled: boolean) => useAllArtists(enabled);

/** Every album summary from /songs/albums (FR-35): sem página, o servidor
 *  agrega a biblioteca inteira em vez de só os primeiros 500 songs. */
export const useLibraryAlbums = (enabled: boolean) => {
  const authReady = useAuthReady();
  const key = keys.albums.list({ scope: "all" });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listAlbumsWithFallback({})),
    enabled: authReady && enabled,
  });
};
