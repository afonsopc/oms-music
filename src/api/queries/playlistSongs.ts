/**
 * Playlist song hooks: infinite position-ordered pages of 100 (FR-48),
 * membership pre-check + add/remove by JOIN-ROW id (FR-49/50).
 *
 * Cast de fronteira via `unknown`: o `MusicPlaylistSong` do SDK e o fio e o
 * `PlaylistSong` do dominio marca `song_id` (SongId), o que o TypeScript nao
 * considera comparavel numa conversao directa.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { collect } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { FULL_PAGE, WHOLE_LIST_LIMIT, guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { PlaylistSong } from "@/domain/playlist";

export const PLAYLIST_SONGS_PAGE_SIZE = 100;

/** One position-ordered page (FR-48: infinite pages of 100). The offline
 *  resolver reads exactly these two arguments. */
export const listPlaylistSongsPage = async (
  playlistId: PlaylistId,
  page: number,
): Promise<PlaylistSong[]> =>
  (await oms().music.playlists.songs.list({ playlistId, page, pageSize: PLAYLIST_SONGS_PAGE_SIZE }))
    .items as unknown as PlaylistSong[];

/** Membership pre-check for the AddToPlaylist dialog (FR-49): every row. */
export const listSongMemberships = async (songId: SongId): Promise<PlaylistSong[]> =>
  (await collect(
    await oms().music.playlists.songs.list({ songId, pageSize: FULL_PAGE, order: null }),
    WHOLE_LIST_LIMIT,
  )) as unknown as PlaylistSong[];

const listPlaylistSongsPageWithFallback = withOfflineFallback(
  listPlaylistSongsPage,
  "playlistSongs",
);

export const usePlaylistSongsInfinite = (playlistId: PlaylistId | null) => {
  const authReady = useAuthReady();
  const key =
    playlistId != null ? keys.playlistSongs(playlistId) : ["playlistSongs", "none"];
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () =>
        listPlaylistSongsPageWithFallback(playlistId as PlaylistId, pageParam),
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
      oms().music.playlists.songs.add(playlistId, songId) as unknown as Promise<PlaylistSong>,
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
 * rolls back on error. `joinRowId` is the JOIN-ROW id, not the song id.
 */
export const useRemovePlaylistSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ joinRowId }: { joinRowId: number; playlistId: PlaylistId; songId: SongId }) =>
      oms().music.playlists.songs.remove(joinRowId),
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
