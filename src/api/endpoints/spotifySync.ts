/** Spotify sync REST. ALL endpoints 403 unless the account has
 *  allowed_to_use_spotify (hide the tab AND expect 403s, FR-103). */
import { request } from "../client";
import type { SpotifySyncPreview, SpotifySyncStatus } from "@/domain/imports";

export const getSpotifySyncStatus = (): Promise<SpotifySyncStatus> =>
  request("GET", "/spotify_syncs/status");

/** 404 not linked; 502 upstream. */
export const getSpotifySyncPreview = (): Promise<SpotifySyncPreview> =>
  request("GET", "/spotify_syncs/preview", { timeoutMs: 60_000 });

/** Keys are applied only when present. Deselecting a playlist / disabling
 *  liked-sync DELETES the local copies immediately (destructive warning). */
export const updateSpotifySyncSettings = (settings: {
  enabled_playlists?: string[];
  sync_liked?: boolean;
  auto_sync?: boolean;
}): Promise<{ ok: boolean; sync_settings: unknown }> =>
  request("PATCH", "/spotify_syncs/settings", { body: settings });

/** 409 while a sync is already running. */
export const triggerSpotifySync = (
  playlistIds?: string[],
): Promise<{ ok: boolean; queued_at: string }> =>
  request("POST", "/spotify_syncs", {
    body: playlistIds ? { playlist_ids: playlistIds } : {},
  });
