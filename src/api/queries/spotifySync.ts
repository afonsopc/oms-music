/**
 * Spotify sync hooks (FR-103). ALL endpoints 403 unless the account has
 * allowed_to_use_spotify: hide the tab AND expect 403s. Poll status 1.5s
 * while a sync runs.
 *
 * Os tipos de resposta ficam os do domínio (o `SpotifySyncStatus` do SDK
 * torna opcional o que o servidor manda sempre em `sync_progress`).
 */
import { useQuery } from "@tanstack/react-query";
import type { UpdateSpotifySyncSettingsInput } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SpotifySyncPreview, SpotifySyncStatus } from "@/domain/imports";

const SYNC_POLL_MS = 1_500;

export const getSpotifySyncStatus = (): Promise<SpotifySyncStatus> =>
  oms().music.imports.spotify.status() as Promise<SpotifySyncStatus>;

/** 404 not linked; 502 upstream. */
export const getSpotifySyncPreview = (): Promise<SpotifySyncPreview> =>
  oms().music.imports.spotify.preview() as Promise<SpotifySyncPreview>;

/** Keys are applied only when present. Deselecting a playlist / disabling
 *  liked-sync DELETES the local copies immediately (destructive warning). */
export const updateSpotifySyncSettings = (settings: UpdateSpotifySyncSettingsInput) =>
  oms().music.imports.spotify.updateSettings(settings);

/** 409 while a sync is already running. */
export const triggerSpotifySync = (playlistIds?: string[]) =>
  oms().music.imports.spotify.start(playlistIds ? { playlistIds } : {});

const isRunning = (status: SpotifySyncStatus | undefined): boolean =>
  !!status && status.connected && status.sync_progress?.state === "running";

export const useSpotifySyncStatus = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.spotifySync.status;
  return useQuery<SpotifySyncStatus>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSpotifySyncStatus()),
    enabled: authReady && enabled,
    refetchInterval: (query) => (isRunning(query.state.data) ? SYNC_POLL_MS : false),
  });
};

export const useSpotifySyncPreview = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.spotifySync.preview;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSpotifySyncPreview()),
    enabled: authReady && enabled,
  });
};
