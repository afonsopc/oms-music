/**
 * Liked songs REST (FR-45/46). Cursor pagination: strictly-less-than on
 * liked_at (offset pages would shift when the user likes mid-scroll).
 * DELETE is keyed by SONG id.
 */
import { request } from "../client";
import type { SongId } from "@/domain/ids";
import type { LikedSong } from "@/domain/playlist";

export const LIKED_PAGE_LIMIT = 100;

export const listLiked = (before?: string): Promise<LikedSong[]> =>
  request("GET", "/liked_songs", {
    params: before ? { limit: LIKED_PAGE_LIMIT, before } : { limit: LIKED_PAGE_LIMIT },
  });

/** Cheap heart-state set: number[] of song ids. */
export const listLikedIds = (): Promise<number[]> => request("GET", "/liked_songs/ids");

/** Idempotent. */
export const likeSong = (songId: SongId): Promise<LikedSong> =>
  request("POST", "/liked_songs", { body: { song_id: songId } });

/** Keyed by SONG id; 404 "Not liked" is fine to swallow on rollback races. */
export const unlikeSong = (songId: SongId): Promise<void> =>
  request("DELETE", `/liked_songs/${songId}`);
