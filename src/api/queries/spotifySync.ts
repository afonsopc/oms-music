/** Spotify sync hooks (FR-103). Gate on allowed_to_use_spotify: hide the tab
 *  AND expect 403s. Poll status 1.5s while a sync runs. */
import { useQuery } from "@tanstack/react-query";
import { getSpotifySyncPreview, getSpotifySyncStatus } from "../endpoints/spotifySync";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SpotifySyncStatus } from "@/domain/imports";

const SYNC_POLL_MS = 1_500;

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
