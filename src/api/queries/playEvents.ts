/**
 * Play-event hooks: home top tiles + artist rails + popular lists.
 *
 * Os tipos das linhas ficam aqui e não no SDK: o servidor serializa o
 * `artist` com a view compact do ArtistBlueprint, que HERDA os campos base (um
 * Artist inteiro), e o `song` com o SongBlueprint base (um Song inteiro); os
 * `MusicArtistPayload`/`MusicSongPayload` do SDK são mais estreitos do que o
 * fio (lacuna do SDK), daí o cast de fronteira.
 */
import { useQuery } from "@tanstack/react-query";
import type { PlayEventWindow } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { Artist } from "@/domain/artist";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";

export interface RecentlyPlayedAlbum {
  album: string | null;
  artist: Artist | string | null; // polymorphic (legacy rows are strings)
  artwork_media_id: string | null;
  last_played_at: string;
}

export interface RecentlyPlayedSong {
  song: Song;
  last_played_at: string;
}

export interface TopSongRow {
  song: Song;
  play_count: number;
}

export interface TopAlbumRow {
  album: string | null;
  artist: Artist | string | null;
  artwork_media_id: string | null;
  play_count: number;
}

export interface TopArtistRow {
  artist: Artist | string;
  play_count: number;
}

export type TopSince = PlayEventWindow;

/** Fire-and-forget play recording; the server dedupes 30s repeats. */
export const postPlayEvent = (songId: SongId): Promise<unknown> =>
  oms().music.playlists.plays.record({ songId });

export const listRecentAlbums = (limit = 8): Promise<RecentlyPlayedAlbum[]> =>
  // Cast de fronteira: o `artist` é um Artist inteiro no fio (ver cabeçalho).
  oms().music.playlists.plays.recentAlbums({ limit }) as Promise<RecentlyPlayedAlbum[]>;

export const listRecentSongs = (limit = 24): Promise<RecentlyPlayedSong[]> =>
  oms().music.playlists.plays.recentSongs({ limit }) as Promise<RecentlyPlayedSong[]>;

export const listTopArtists = (since: TopSince = "30d", limit = 10): Promise<TopArtistRow[]> =>
  oms().music.playlists.plays.topArtists({ since, limit }) as Promise<TopArtistRow[]>;

export const listTopSongs = (
  opts: { artist?: string; since?: TopSince; limit?: number } = {},
): Promise<TopSongRow[]> =>
  oms().music.playlists.plays.topSongs({
    since: opts.since ?? "all",
    limit: opts.limit ?? 5,
    ...(opts.artist !== undefined ? { artist: opts.artist } : {}),
  }) as Promise<TopSongRow[]>;

/** Up to 8 recently played albums (FR-24); handle polymorphic `artist`. */
export const useRecentAlbums = (limit = 8, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.recentAlbums(limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listRecentAlbums(limit)),
    enabled: authReady && enabled,
  });
};

/** "Your artists" rail: top artists of the last 30 days (FR-28). */
export const useTopArtists = (since: TopSince = "30d", limit = 10, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("artist", since, null, limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listTopArtists(since, limit)),
    enabled: authReady && enabled,
  });
};

/** Top global do utilizador (Rewind): sem filtro de artista. */
export const useTopSongsOverall = (
  since: TopSince = "all",
  limit = 5,
  enabled = true,
) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("song", since, null, limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listTopSongs({ since, limit })),
    enabled: authReady && enabled,
  });
};

/** Artist "Popular" top 5 by all-time plays (FR-39). */
export const useTopSongs = (
  artist: string | null,
  opts: { since?: TopSince; limit?: number; enabled?: boolean } = {},
) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("song", opts.since ?? "all", artist, opts.limit ?? 5);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listTopSongs({ artist: artist ?? undefined, since: opts.since, limit: opts.limit }),
    ),
    enabled: authReady && (opts.enabled ?? true) && !!artist,
  });
};
