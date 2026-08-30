/**
 * Liked songs hooks (FR-45/46). `/liked_songs/ids` is the optimistic source
 * of truth for every heart; toggle patches the set with rollback. DELETE is
 * keyed by SONG id. The list is cursor-paged (strictly-less-than on liked_at)
 * so liking mid-scroll never shifts pages.
 *
 * `listLiked(before?)` and `listLikedIds()` are the offline-fallback boundary:
 * the resolver reads "no args = ids", "one nullish arg = first page".
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import type { SongId } from "@/domain/ids";
import type { LikedSong } from "@/domain/playlist";

export const LIKED_PAGE_LIMIT = 100;

export const listLiked = async (before?: string): Promise<LikedSong[]> =>
  (await oms().music.songs.listLiked({ limit: LIKED_PAGE_LIMIT, before })) as LikedSong[];

/** Cheap heart-state set: number[] of song ids. */
export const listLikedIds = (): Promise<number[]> => oms().music.songs.likedIds();

const listLikedWithFallback = withOfflineFallback(listLiked, "liked");
const listLikedIdsWithFallback = withOfflineFallback(listLikedIds, "liked");

/** Cursor-paged infinite liked list; addedAt = liked_at (FR-45). */
export const useLikedInfinite = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.liked.list;
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () => listLikedWithFallback(pageParam || undefined))(),
    initialPageParam: "" as string,
    getNextPageParam: (lastPage) =>
      lastPage.length === LIKED_PAGE_LIMIT
        ? lastPage[lastPage.length - 1].liked_at
        : undefined,
    enabled: authReady && enabled,
  });
};

export const useLikedIds = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.liked.ids;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listLikedIdsWithFallback()),
    enabled: authReady && enabled,
    staleTime: 30_000,
  });
};

/** Optimistic like toggle with rollback (FR-46). */
export const useToggleLike = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ songId, liked }: { songId: SongId; liked: boolean }) => {
      if (liked) {
        await oms().music.songs.unlike(songId);
      } else {
        // retry:false por chamada: o SDK opta o like num retry com backoff, e
        // um 429 aqui deve falhar depressa para o rollback, não esperar um minuto.
        await oms().music.songs.like(songId, { retry: false });
      }
    },
    onMutate: async ({ songId, liked }) => {
      await qc.cancelQueries({ queryKey: keys.liked.ids });
      const previous = qc.getQueryData<number[]>(keys.liked.ids);
      if (previous) {
        qc.setQueryData<number[]>(
          keys.liked.ids,
          liked ? previous.filter((id) => id !== songId) : [...previous, songId],
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.liked.ids, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.liked.ids });
      void qc.invalidateQueries({ queryKey: keys.liked.list });
    },
  });
};
