/** Playlist hooks (FR-27, FR-35, FR-47..53 data halves). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  reorderPlaylist,
  updatePlaylist,
  uploadPlaylistArtwork,
} from "../endpoints/playlists";
import { pageModifier } from "../params";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { Playlist } from "@/domain/playlist";

const listPlaylistsWithFallback = withOfflineFallback(listPlaylists, "playlists");
// Same key: the resolver dispatches a single id arg as the detail lookup.
const getPlaylistWithFallback = withOfflineFallback(getPlaylist, "playlists");

export const usePlaylists = (opts: { page?: `${number}:${number}`; enabled?: boolean } = {}) => {
  const authReady = useAuthReady();
  const key = keys.playlists.list({ page: opts.page ?? "1:500" });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listPlaylistsWithFallback({ modifiers: { page: opts.page ?? pageModifier(1, 500) } }),
    ),
    enabled: authReady && (opts.enabled ?? true),
  });
};

/** Ranked name-search candidates for suggestions/results (FR-30/33). */
export const useSearchPlaylists = (term: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = term.trim();
  const key = keys.playlists.list({ search: trimmed });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      const playlists = await listPlaylistsWithFallback({
        search: { name: trimmed },
        modifiers: { page: pageModifier(1, 20) },
      });
      return rankByMatch(playlists, trimmed, (p) => p.name);
    }),
    enabled: authReady && enabled && trimmed.length > 0,
  });
};

export const usePlaylist = (id: PlaylistId | null) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.playlists.detail(id) : ["playlists", "detail", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getPlaylistWithFallback(id as PlaylistId)),
    enabled: authReady && id != null,
  });
};

export const useCreatePlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; artwork_media_id?: string; song_ids?: SongId[] }) =>
      createPlaylist(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

/** Optimistic rename (local-first): the new name paints everywhere at once. */
export const useUpdatePlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: PlaylistId;
      body: { name?: string; artwork_media_id?: string | null };
    }) => updatePlaylist(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: keys.playlists.all });
      const detailKey = keys.playlists.detail(id);
      const previousDetail = qc.getQueryData<Playlist>(detailKey);
      if (previousDetail) qc.setQueryData(detailKey, { ...previousDetail, ...body });
      const previousLists = qc.getQueriesData<Playlist[]>({
        queryKey: [...keys.playlists.all, "list"],
      });
      for (const [key, list] of previousLists) {
        if (!list) continue;
        qc.setQueryData(
          key,
          list.map((p) => (p.id === id ? { ...p, ...body } : p)),
        );
      }
      return { previousDetail, previousLists };
    },
    onError: (_error, { id }, context) => {
      if (context?.previousDetail) {
        qc.setQueryData(keys.playlists.detail(id), context.previousDetail);
      }
      for (const [key, list] of context?.previousLists ?? []) {
        qc.setQueryData(key, list);
      }
    },
    onSuccess: (playlist) => {
      qc.setQueryData(keys.playlists.detail(playlist.id), playlist);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

/** Optimistic delete (local-first): the row leaves the library instantly. */
export const useDeletePlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PlaylistId) => deletePlaylist(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.playlists.all });
      const previousLists = qc.getQueriesData<Playlist[]>({
        queryKey: [...keys.playlists.all, "list"],
      });
      for (const [key, list] of previousLists) {
        if (!list) continue;
        qc.setQueryData(
          key,
          list.filter((p) => p.id !== id),
        );
      }
      return { previousLists };
    },
    onError: (_error, _id, context) => {
      for (const [key, list] of context?.previousLists ?? []) {
        qc.setQueryData(key, list);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

/** Complete song-id order; refetches the pages afterwards (FR-50). */
export const useReorderPlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, songIds }: { id: PlaylistId; songIds: SongId[] }) =>
      reorderPlaylist(id, songIds),
    onSettled: (_data, _error, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.playlistSongs(id) });
    },
  });
};

export const useUploadPlaylistArtwork = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      artwork,
    }: {
      id: PlaylistId;
      artwork: { uri: string; name: string; type: string };
    }) => uploadPlaylistArtwork(id, artwork),
    onSuccess: (playlist) => {
      qc.setQueryData(keys.playlists.detail(playlist.id), playlist);
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

export const useCopyPlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PlaylistId) => copyPlaylist(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};
