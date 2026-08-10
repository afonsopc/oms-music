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

/**
 * Optimistic MEMBERSHIP (local-first): the checkmark in the add-to-playlist
 * sheet flips the moment it is tapped. Only the membership set is guessed -
 * the join ROW needs the server's id and position, so the pages refresh via
 * the settled invalidation instead of a fabricated row.
 */
export const useAddPlaylistSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, songId }: { playlistId: PlaylistId; songId: SongId }) =>
      addPlaylistSong(playlistId, songId),
    onMutate: async ({ playlistId, songId }) => {
      const key = keys.songMembership(songId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PlaylistSong[]>(key);
      if (previous && !previous.some((row) => row.playlist_id === playlistId)) {
        // id 0 marks the placeholder; nothing keys rows by join id here, and
        // the settled invalidation replaces it with the real row.
        qc.setQueryData<PlaylistSong[]>(key, [
          ...previous,
          { ...previous[0], id: 0, playlist_id: playlistId, song_id: songId } as PlaylistSong,
        ]);
      }
      return { previous };
    },
    onError: (_error, { songId }, context) => {
      if (context?.previous) qc.setQueryData(keys.songMembership(songId), context.previous);
    },
    onSettled: (_row, _error, { playlistId, songId }) => {
      void qc.invalidateQueries({ queryKey: keys.playlistSongs(playlistId) });
      void qc.invalidateQueries({ queryKey: keys.songMembership(songId) });
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
