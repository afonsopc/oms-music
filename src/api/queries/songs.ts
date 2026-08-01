/** Song hooks. Search hooks apply the MANDATORY rankByMatch re-rank (FR-30). */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSong,
  getArtistPictures,
  getSong,
  listAlbumSongs,
  listAlbums,
  listArtistSongs,
  listRandomAlbums,
  listSongs,
  searchSongsByTitle,
  updateSong,
  type ArtistRole,
  type SongPatch,
} from "../endpoints/songs";
import { pageModifier } from "../params";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import { rankByMatch } from "@/domain/rank";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";

const listSongsWithFallback = withOfflineFallback(listSongs, "songs");
const listAlbumSongsWithFallback = withOfflineFallback(listAlbumSongs, "songs");
const listArtistSongsWithFallback = withOfflineFallback(listArtistSongs, "songs");
const listAlbumsWithFallback = withOfflineFallback(listAlbums, "albums");
const listRandomAlbumsWithFallback = withOfflineFallback(listRandomAlbums, "albums");

export const SONGS_MANAGEMENT_PAGE_SIZE = 500;

/** Infinite /songs pages for the management screen (FR-96). */
export const useSongsInfinite = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.songs.infinite({ page: SONGS_MANAGEMENT_PAGE_SIZE });
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      guardedQueryFn(key, () =>
        listSongsWithFallback({
          modifiers: { page: pageModifier(pageParam, SONGS_MANAGEMENT_PAGE_SIZE) },
        }),
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

/** Ranked title-search candidates (1:20 page, top N is the caller's cut). */
export const useSearchSongs = (term: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = term.trim();
  const key = keys.songs.list({ search: trimmed });
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      const songs = await searchSongsByTitle(trimmed);
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
        modifiers: { page: pageModifier(1, 20) },
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
      listAlbumsWithFallback({
        exact_search: { artist: artistNameOrSlug },
        artist_role: role,
        modifiers: { page: pageModifier(1, 500) },
      }),
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
    queryFn: guardedQueryFn(key, () => getArtistPictures(name as string)),
    enabled: authReady && enabled && !!name,
    staleTime: 60 * 60 * 1000,
  });
};

export const useUpdateSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
      artwork,
    }: {
      id: SongId;
      patch: SongPatch;
      artwork?: { uri: string; name: string; type: string };
    }) => updateSong(id, patch, artwork),
    onSuccess: (song: Song) => {
      qc.setQueryData(keys.songs.detail(song.id), song);
      void qc.invalidateQueries({ queryKey: keys.songs.all });
      void qc.invalidateQueries({ queryKey: keys.albums.all });
      void qc.invalidateQueries({ queryKey: keys.artists.all });
    },
  });
};

export const useDeleteSong = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: SongId) => deleteSong(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.songs.all });
      void qc.invalidateQueries({ queryKey: keys.albums.all });
      void qc.invalidateQueries({ queryKey: keys.liked.list });
    },
  });
};
