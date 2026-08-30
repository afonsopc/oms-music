/**
 * Artist hooks (FR-36..38 data, FR-97 mutations).
 *
 * Os fetchers nomeados são a fronteira do fallback offline: os resolvers
 * despacham pela forma dos argumentos (`listArtistsPage(page, order)`,
 * `searchArtists(name)`, `getArtist(idOrSlug)`, `listAllArtists()`), por isso
 * as assinaturas fazem parte do contrato (downloads/offlineLibrary.ts).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ARTIST_ROSTER_PAGE_SIZE, collect, type UpdateArtistInput } from "@omelhorsite/sdk";
import { oms, toFileInput, type PickedFile } from "../oms";
import { keys } from "../queryKeys";
import { FULL_PAGE, WHOLE_LIST_LIMIT, guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { Artist, ArtistMetadata, ArtistOverview } from "@/domain/artist";
import type { ArtistId } from "@/domain/ids";

export const ARTISTS_PAGE_SIZE = ARTIST_ROSTER_PAGE_SIZE;

export type ArtistsRosterOrder = "name:asc" | "created_at:desc";

/** One roster page (FR-37: infinite 60/page). */
export const listArtistsPage = async (page: number, order: ArtistsRosterOrder): Promise<Artist[]> =>
  (await oms().music.artists.list({ page, pageSize: ARTISTS_PAGE_SIZE, order })).items as Artist[];

/** Server-side roster search (debounced by the screen); one page of 60. */
export const searchArtists = async (name: string): Promise<Artist[]> =>
  (
    await oms().music.artists.list({
      name,
      page: 1,
      pageSize: ARTISTS_PAGE_SIZE,
      order: "name:asc",
    })
  ).items as Artist[];

/** The whole roster, name:asc (the Library tab, the settings table). */
export const listAllArtists = async (): Promise<Artist[]> =>
  (await collect(
    await oms().music.artists.list({ pageSize: FULL_PAGE, order: "name:asc" }),
    WHOLE_LIST_LIMIT,
  )) as Artist[];

/** Resolves numeric id, slug, then canonical name; 404 "Artist not found". */
export const getArtist = (idOrSlug: string): Promise<Artist> =>
  oms().music.artists.get(idOrSlug) as Promise<Artist>;

const listArtistsPageWithFallback = withOfflineFallback(listArtistsPage, "artists");
const searchArtistsWithFallback = withOfflineFallback(searchArtists, "artists");
const listAllArtistsWithFallback = withOfflineFallback(listAllArtists, "artists");
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

/** Whole roster, name:asc (FR-35); the Library tab and the settings table. */
export const useAllArtists = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.list({ scope: "all", order: "name:asc" });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listAllArtistsWithFallback()),
    enabled: authReady && enabled,
  });
};

export const useArtistOverview = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.overview;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(
      key,
      () => oms().music.artists.overview() as Promise<ArtistOverview>,
    ),
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

/** Legacy Last.fm shim; ALWAYS 200 (unknown artist = all-null echo). */
export const useArtistMetadata = (name: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artists.metadata(name ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(
      key,
      () => oms().music.songs.artistMetadata(name as string) as Promise<ArtistMetadata>,
    ),
    enabled: authReady && enabled && !!name,
    staleTime: 60 * 60 * 1000,
  });
};

/** FLAT top-level PATCH (FR-97); rename re-slugs server-side. */
export const useUpdateArtist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: ArtistId; body: UpdateArtistInput }) =>
      oms().music.artists.update(id, body) as Promise<Artist>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
      void qc.invalidateQueries({ queryKey: keys.songs.all });
    },
  });
};

export const useDeleteArtist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ArtistId) => oms().music.artists.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

export const useUploadArtistImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, image }: { id: ArtistId; image: PickedFile }) =>
      oms().music.artists.uploadImage(id, toFileInput(image)) as Promise<Artist>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

/** Multipart field `banner` (the SDK knows; the web's `image` field 400s). */
export const useUploadArtistBanner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, banner }: { id: ArtistId; banner: PickedFile }) =>
      oms().music.artists.uploadBanner(id, toFileInput(banner)) as Promise<Artist>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};
