/**
 * Liked songs hooks (FR-45/46). `/liked_songs/ids` is the optimistic source
 * of truth for every heart; toggle patches the set with rollback. DELETE is
 * keyed by SONG id. The list is cursor-paged so liking mid-scroll never
 * shifts pages.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { likeSong, listLiked, listLikedIds, unlikeSong, LIKED_PAGE_LIMIT } from "../endpoints/likedSongs";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import type { SongId } from "@/domain/ids";

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
        await unlikeSong(songId);
      } else {
        await likeSong(songId);
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
