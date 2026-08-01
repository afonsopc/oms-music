/** Artist hooks (FR-36..38 data, FR-97 mutations). */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteArtist,
  getArtist,
  getArtistMetadata,
  getArtistOverview,
  listArtistsPage,
  searchArtists,
  updateArtist,
  uploadArtistBanner,
  uploadArtistImage,
  ARTISTS_PAGE_SIZE,
  type ArtistsRosterOrder,
} from "../endpoints/artists";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { ArtistId } from "@/domain/ids";

const listArtistsPageWithFallback = withOfflineFallback(listArtistsPage, "artists");
const searchArtistsWithFallback = withOfflineFallback(searchArtists, "artists");
const getArtistWithFallback = withOfflineFallback(getArtist, "artists");

/** Infinite roster, 60/page; switching sort restarts the query (FR-37). */
export const useArtistsRoster = (order: ArtistsRosterOrder, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.infinite(order, null);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () => listArtistsPageWithFallback(pageParam, order))(),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.length === ARTISTS_PAGE_SIZE ? lastPageParam + 1 : undefined,
    enabled: authReady && enabled,
  });
};

/** Debounced server search replaces the roster grid while filtering. */
export const useArtistsSearch = (term: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = term.trim();
  const key = keys.artists.infinite("name:asc", trimmed);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      const artists = await searchArtistsWithFallback(trimmed);
      return rankByMatch(artists, trimmed, (a) => a.name);
    }),
    enabled: authReady && enabled && trimmed.length > 0,
  });
};

/** Ranked name-search candidates for suggestions (FR-30). */
export const useSearchArtists = useArtistsSearch;

export const useArtistOverview = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.overview;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getArtistOverview()),
    enabled: authReady && enabled,
    staleTime: 10 * 60 * 1000, // server caches 1h/user
  });
};

/** Slug-or-name resolve; the screen falls back to the raw segment on 404. */
export const useArtist = (idOrSlug: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.detail(idOrSlug ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getArtistWithFallback(idOrSlug as string)),
    enabled: authReady && enabled && !!idOrSlug,
    staleTime: 5 * 60 * 1000,
  });
};

export const useArtistMetadata = (name: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.metadata(name ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getArtistMetadata(name as string)),
    enabled: authReady && enabled && !!name,
    staleTime: 60 * 60 * 1000,
  });
};

/** FLAT top-level PATCH (FR-97); rename re-slugs server-side. */
export const useUpdateArtist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: ArtistId;
      body: { name?: string; gallery_image_urls?: string[] };
    }) => updateArtist(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
      void qc.invalidateQueries({ queryKey: keys.songs.all });
    },
  });
};

export const useDeleteArtist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ArtistId) => deleteArtist(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

export const useUploadArtistImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      image,
    }: {
      id: ArtistId;
      image: { uri: string; name: string; type: string };
    }) => uploadArtistImage(id, image),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

/** Multipart field `banner` (the web's `image` field 400s - do not copy). */
export const useUploadArtistBanner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      banner,
    }: {
      id: ArtistId;
      banner: { uri: string; name: string; type: string };
    }) => uploadArtistBanner(id, banner),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};
