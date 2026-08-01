/** Playlist song hooks: infinite position-ordered pages of 100 (FR-48),
 *  membership pre-check + add/remove by JOIN-ROW id (FR-49/50). */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  addPlaylistSong,
  listPlaylistSongsPage,
  listSongMemberships,
  removePlaylistSong,
  PLAYLIST_SONGS_PAGE_SIZE,
} from "../endpoints/playlistSongs";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { PlaylistSong } from "@/domain/playlist";

export const usePlaylistSongsInfinite = (playlistId: PlaylistId | null) => {
  const authReady = useAuthReady();
  const key =
    playlistId != null ? keys.playlistSongs(playlistId) : ["playlistSongs", "none"];
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () =>
        listPlaylistSongsPage(playlistId as PlaylistId, pageParam),
      )(),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.length === PLAYLIST_SONGS_PAGE_SIZE ? lastPageParam + 1 : undefined,
    enabled: authReady && playlistId != null,
  });
};

/** Which playlists already contain the song (AddToPlaylist pre-check). */
export const useSongMemberships = (songId: SongId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = songId != null ? keys.songMembership(songId) : ["playlistSongs", "membership", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listSongMemberships(songId as SongId)),
    enabled: authReady && enabled && songId != null,
  });
};

export const useAddPlaylistSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, songId }: { playlistId: PlaylistId; songId: SongId }) =>
      addPlaylistSong(playlistId, songId),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: keys.playlistSongs(row.playlist_id) });
      void qc.invalidateQueries({ queryKey: keys.songMembership(row.song_id) });
    },
  });
};

/**
 * Optimistic row removal (FR-50): drops the join row from the loaded pages,
 * rolls back on error.
 */
export const useRemovePlaylistSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ joinRowId }: { joinRowId: number; playlistId: PlaylistId; songId: SongId }) =>
      removePlaylistSong(joinRowId),
    onMutate: async ({ joinRowId, playlistId }) => {
      const key = keys.playlistSongs(playlistId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InfiniteData<PlaylistSong[]>>(key);
      if (previous) {
        qc.setQueryData<InfiniteData<PlaylistSong[]>>(key, {
          ...previous,
          pages: previous.pages.map((page) => page.filter((row) => row.id !== joinRowId)),
        });
      }
      return { previous };
    },
    onError: (_error, { playlistId }, context) => {
      if (context?.previous) {
        qc.setQueryData(keys.playlistSongs(playlistId), context.previous);
      }
    },
    onSettled: (_data, _error, { playlistId, songId }) => {
      void qc.invalidateQueries({ queryKey: keys.playlistSongs(playlistId) });
      void qc.invalidateQueries({ queryKey: keys.songMembership(songId) });
    },
  });
};
