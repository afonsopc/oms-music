/**
 * Song hooks. Search hooks apply the MANDATORY rankByMatch re-rank (FR-30).
 *
 * Os fetchers nomeados abaixo são a fronteira do fallback offline
 * (contracts/offlineFallback): os resolvers de downloads/offlineLibrary.ts
 * despacham pela FORMA dos argumentos, por isso as assinaturas
 * (`listAlbumSongs(album)`, `listArtistSongs(name, role)`, `listSongsPage(params)`,
 * `listAlbums(params)`, `listRandomAlbums(count)`) fazem parte do contrato.
 *
 * Os tipos do SDK são o fio; os de `@/domain` acrescentam os ids marcados
 * (`SongId`), daí o cast de fronteira em cada fetcher.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collect,
  type ListSongAlbumsParams,
  type ListSongsParams,
  type SongArtistRole,
  type UpdateSongInput,
} from "@omelhorsite/sdk";
import { oms, toFileInput, type PickedFile } from "../oms";
import { keys } from "../queryKeys";
import { FULL_PAGE, WHOLE_LIST_LIMIT, guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { AlbumSummary } from "@/domain/album";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";

export type ArtistRole = SongArtistRole;

/** One explicit page of /songs (the management screen, the search boxes). */
export const listSongsPage = async (params: ListSongsParams): Promise<Song[]> =>
  (await oms().music.songs.list({ order: null, ...params })).items as Song[];

/** Every song of an album; album null queries the no-album bucket. */
export const listAlbumSongs = async (album: string | null): Promise<Song[]> =>
  (await collect(
    await oms().music.songs.list({ album, pageSize: FULL_PAGE, order: null }),
    WHOLE_LIST_LIMIT,
  )) as Song[];

/** Every song where the named artist has the given role. */
export const listArtistSongs = async (
  artistNameOrSlug: string,
  role: ArtistRole,
): Promise<Song[]> =>
  (await collect(
    await oms().music.songs.list({
      artist: artistNameOrSlug,
      artistRole: role,
      pageSize: FULL_PAGE,
      order: null,
    }),
    WHOLE_LIST_LIMIT,
  )) as Song[];

/**
 * Album summaries. Sem `page` o servidor agrega a biblioteca inteira (a acção
 * `albums` não força página); com `page`/`pageSize` devolve a janela pedida.
 */
export const listAlbums = async (params: ListSongAlbumsParams = {}): Promise<AlbumSummary[]> =>
  (await oms().music.songs.albums({ order: null, ...params })) as AlbumSummary[];

export const listRandomAlbums = (count = 10): Promise<AlbumSummary[]> =>
  listAlbums({ random: true, page: 1, pageSize: count });

export const getSong = (id: SongId): Promise<Song> =>
  oms().music.songs.get(id) as Promise<Song>;

const listSongsPageWithFallback = withOfflineFallback(listSongsPage, "songs");
const listAlbumSongsWithFallback = withOfflineFallback(listAlbumSongs, "songs");
const listArtistSongsWithFallback = withOfflineFallback(listArtistSongs, "songs");
const listAlbumsWithFallback = withOfflineFallback(listAlbums, "albums");
const listRandomAlbumsWithFallback = withOfflineFallback(listRandomAlbums, "albums");

export const SONGS_MANAGEMENT_PAGE_SIZE = FULL_PAGE;

/** Infinite /songs pages for the management screen (FR-96). */
export const useSongsInfinite = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.songs.infinite({ page: SONGS_MANAGEMENT_PAGE_SIZE });
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () =>
        listSongsPageWithFallback({ page: pageParam, pageSize: SONGS_MANAGEMENT_PAGE_SIZE }),
      )(),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.length === SONGS_MANAGEMENT_PAGE_SIZE ? lastPageParam + 1 : undefined,
    enabled: authReady && enabled,
  });
};

export const useSong = (id: SongId | null) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.songs.detail(id) : ["songs", "detail", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSong(id as SongId)),
    enabled: authReady && id != null,
  });
};

/** Ranked title-search candidates (one page of 20, top N is the caller's cut). */
export const useSearchSongs = (term: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = term.trim();
  const key = keys.songs.list({ search: trimmed });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      const songs = await listSongsPageWithFallback({ title: trimmed, page: 1, pageSize: 20 });
      return rankByMatch(songs, trimmed, (s) => s.title);
    }),
    enabled: authReady && enabled && trimmed.length > 0,
  });
};

/** Every song of an album (album null = unknown album via the sentinel). */
export const useAlbumSongs = (album: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.songs.byAlbum(album);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listAlbumSongsWithFallback(album)),
    enabled: authReady && enabled,
  });
};

export const useArtistSongs = (
  artistNameOrSlug: string | null,
  role: ArtistRole,
  enabled = true,
) => {
  const authReady = useAuthReady();
  const key = keys.songs.byArtist(artistNameOrSlug ?? "", role);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listArtistSongsWithFallback(artistNameOrSlug as string, role),
    ),
    enabled: authReady && enabled && !!artistNameOrSlug,
  });
};

/** Album grids: search / by-artist / random rails. */
export const useSearchAlbums = (term: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = term.trim();
  const key = keys.albums.list({ search: trimmed });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      const albums = await listAlbumsWithFallback({
        search: { album: trimmed },
        page: 1,
        pageSize: 20,
      });
      return rankByMatch(albums, trimmed, (a) => a.name);
    }),
    enabled: authReady && enabled && trimmed.length > 0,
  });
};

export const useArtistAlbums = (
  artistNameOrSlug: string | null,
  role: ArtistRole,
  enabled = true,
) => {
  const authReady = useAuthReady();
  const key = keys.albums.list({ artist: artistNameOrSlug, role });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      // Sem página: os álbuns de UM artista são a lista inteira que a app
      // precisa, e o servidor agrega-a de uma vez.
      listAlbumsWithFallback({ artist: artistNameOrSlug as string, artistRole: role }),
    ),
    enabled: authReady && enabled && !!artistNameOrSlug,
  });
};

/** "Recommendations today": 10 random albums (FR-26). */
export const useRandomAlbums = (count = 10, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.albums.random(count);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listRandomAlbumsWithFallback(count)),
    enabled: authReady && enabled,
  });
};

/** Deezer picture lookup for derived artist cards (FR-33). */
export const useArtistPictures = (name: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.songs.artistPictures(name ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => oms().music.songs.artistPictures(name as string)),
    enabled: authReady && enabled && !!name,
    staleTime: 60 * 60 * 1000,
  });
};

/**
 * PATCH /songs/:id (FR-96). JSON quando não há artwork (os `null` limpam o
 * campo), multipart quando há - o SDK escreve o sentinela nos campos nulos do
 * multipart. `featuredArtistNames` deve ir SEMPRE que se editam artistas: um
 * array vazio é "explicitamente nenhum", a ausência da chave liga a heurística
 * antiga de "feat." no título.
 */
export const useUpdateSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
      artwork,
    }: {
      id: SongId;
      patch: Omit<UpdateSongInput, "artwork">;
      artwork?: PickedFile;
    }) =>
      oms().music.songs.update(id, {
        ...patch,
        ...(artwork ? { artwork: toFileInput(artwork) } : {}),
      }) as Promise<Song>,
    onSuccess: (song: Song) => {
      qc.setQueryData(keys.songs.detail(song.id), song);
      void qc.invalidateQueries({ queryKey: keys.songs.all });
      void qc.invalidateQueries({ queryKey: keys.albums.all });
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

/**
 * As fontes que o matcher encontrou para esta música, pontuadas, com as
 * rejeitadas e a razão de cada rejeição.
 *
 * Três pesquisas ao vivo do lado do servidor, logo é lento e caro: só corre
 * quando o diálogo está aberto (`enabled`), com timeout próprio e sem retry -
 * o pool muda de chamada para chamada, repetir não aproxima da resposta.
 */
export const useSongMatchCandidates = (id: SongId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = id !== null ? keys.songs.matchCandidates(id) : ["songs", "matchCandidates", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      oms().music.songs.matchCandidates(id as SongId, {}, { timeoutMs: 90_000 }),
    ),
    enabled: authReady && enabled && id !== null,
    retry: false,
    gcTime: 0,
  });
};

/**
 * Reimporta a música na mesma linha. Sem `sourceUrl` o matcher volta a correr
 * sobre os termos originais; com ele a escolha é aceite tal como veio.
 *
 * Devolve o import a acompanhar: a troca só existe quando ele chega a
 * `complete`, por isso quem chama invalida aí, não aqui.
 */
export const useRematchSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sourceUrl }: { id: SongId; sourceUrl?: string }) =>
      oms().music.songs.rematch(id, sourceUrl === undefined ? {} : { sourceUrl }),
    onSuccess: (_result, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.songs.matchCandidates(id) });
    },
  });
};

export const useDeleteSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: SongId) => oms().music.songs.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.songs.all });
      void qc.invalidateQueries({ queryKey: keys.albums.all });
      void qc.invalidateQueries({ queryKey: keys.liked.list });
    },
  });
};
