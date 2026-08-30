/**
 * Playlist hooks (FR-27, FR-35, FR-47..53 data halves).
 *
 * `listPlaylists({ limit? })` e `getPlaylist(id)` são a fronteira do fallback
 * offline (o resolver despacha um único id como detalhe).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collect, type CreatePlaylistInput, type UpdatePlaylistInput } from "@omelhorsite/sdk";
import { oms, toFileInput, type PickedFile } from "../oms";
import { keys } from "../queryKeys";
import { FULL_PAGE, WHOLE_LIST_LIMIT, guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { Playlist } from "@/domain/playlist";

/**
 * A biblioteca de playlists. Sem `limit` é a lista INTEIRA (percorrida a 500
 * por página); com `limit` é a primeira página desse tamanho (a rail da Home).
 * `order: null` mantém a ordem base do servidor, como o cliente antigo.
 */
export const listPlaylists = async (opts: { limit?: number } = {}): Promise<Playlist[]> => {
  const limit = opts.limit;
  if (limit !== undefined) {
    return (await oms().music.playlists.list({ page: 1, pageSize: limit, order: null }))
      .items as Playlist[];
  }
  return (await collect(
    await oms().music.playlists.list({ pageSize: FULL_PAGE, order: null }),
    WHOLE_LIST_LIMIT,
  )) as Playlist[];
};

export const getPlaylist = (id: PlaylistId): Promise<Playlist> =>
  oms().music.playlists.get(id) as Promise<Playlist>;

const listPlaylistsWithFallback = withOfflineFallback(listPlaylists, "playlists");
// Same key: the resolver dispatches a single id arg as the detail lookup.
const getPlaylistWithFallback = withOfflineFallback(getPlaylist, "playlists");

/** A chave da lista inteira, partilhada com o warm-up (api/warmup.ts). */
export const playlistsListKey = (limit?: number) =>
  keys.playlists.list(limit === undefined ? { scope: "all" } : { limit });

export const usePlaylists = (opts: { limit?: number; enabled?: boolean } = {}) => {
  const authReady = useAuthReady();
  const key = playlistsListKey(opts.limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listPlaylistsWithFallback({ limit: opts.limit })),
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
      const page = await oms().music.playlists.list({
        name: trimmed,
        page: 1,
        pageSize: 20,
        order: null,
      });
      return rankByMatch(page.items as Playlist[], trimmed, (p) => p.name);
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

/** `songIds` seeds <= 500 songs, order preserved (radio save-as-playlist). */
export const useCreatePlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaylistInput) =>
      oms().music.playlists.create(input) as Promise<Playlist>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

/** O que o `UpdatePlaylistInput` do SDK muda numa `Playlist` da app. */
const optimisticPatch = (body: UpdatePlaylistInput): Partial<Playlist> => ({
  ...(body.name === undefined ? {} : { name: body.name }),
  ...(body.artworkMediaId === undefined ? {} : { artwork_media_id: body.artworkMediaId }),
});

/** Optimistic rename (local-first): the new name paints everywhere at once. */
export const useUpdatePlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: PlaylistId; body: UpdatePlaylistInput }) =>
      oms().music.playlists.update(id, body) as Promise<Playlist>,
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: keys.playlists.all });
      const patch = optimisticPatch(body);
      const detailKey = keys.playlists.detail(id);
      const previousDetail = qc.getQueryData<Playlist>(detailKey);
      if (previousDetail) qc.setQueryData(detailKey, { ...previousDetail, ...patch });
      const previousLists = qc.getQueriesData<Playlist[]>({
        queryKey: [...keys.playlists.all, "list"],
      });
      for (const [key, list] of previousLists) {
        if (!list) continue;
        qc.setQueryData(
          key,
          list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
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
    mutationFn: (id: PlaylistId) => oms().music.playlists.delete(id),
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
      oms().music.playlists.reorder(id, songIds),
    onSettled: (_data, _error, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.playlistSongs(id) });
    },
  });
};

export const useUploadPlaylistArtwork = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, artwork }: { id: PlaylistId; artwork: PickedFile }) =>
      oms().music.playlists.uploadArtwork(id, toFileInput(artwork)) as Promise<Playlist>,
    onSuccess: (playlist) => {
      qc.setQueryData(keys.playlists.detail(playlist.id), playlist);
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};

/** Works on system playlists; navigates to the returned copy. */
export const useCopyPlaylist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PlaylistId) => oms().music.playlists.copy(id) as Promise<Playlist>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.playlists.all });
    },
  });
};
