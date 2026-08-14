/** Play events REST (API.md section 7). */
import { request } from "../client";
import type { SongId } from "@/domain/ids";
import type { Artist } from "@/domain/artist";
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

export type TopSince = "7d" | "30d" | "90d" | "all";

/** Fire-and-forget play recording; the server dedupes 30s repeats. */
export const postPlayEvent = (songId: SongId): Promise<unknown> =>
  request("POST", "/play_events", { body: { song_id: songId } });

export const listRecentAlbums = (limit = 8): Promise<RecentlyPlayedAlbum[]> =>
  request("GET", "/play_events/recent", { params: { group_by: "album", limit } });

export const listRecentSongs = (limit = 24): Promise<RecentlyPlayedSong[]> =>
  request("GET", "/play_events/recent", { params: { group_by: "song", limit } });

export const listTopArtists = (since: TopSince = "30d", limit = 10): Promise<TopArtistRow[]> =>
  request("GET", "/play_events/top", { params: { scope: "artist", since, limit } });

export const listTopSongs = (
  opts: { artist?: string; since?: TopSince; limit?: number } = {},
): Promise<TopSongRow[]> =>
  request("GET", "/play_events/top", {
    params: {
      scope: "song",
      since: opts.since ?? "all",
      limit: opts.limit ?? 5,
      ...(opts.artist !== undefined ? { artist: opts.artist } : {}),
    },
  });
