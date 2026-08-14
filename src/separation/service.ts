/**
 * The real SeparationService (FR-71, DESIGN 8.7): ONE shared 3 s react-query
 * poll per song id over GET /songs/:id/separation that parks on
 * "no job, no stems" and stops on stems_ready / terminal (complete|failed
 * only - there is NO "canceled"); a projection with a live elapsed counter;
 * trigger/delete; and the patch wiring - on ready the queue entry is patched
 * in place via engine.patchQueueSong (cause "patch": never restarts audio).
 *
 * WP7's cog and WP11's songs screen consume this exclusively through
 * contracts/separation (getSeparationService()).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  deleteSeparation as deleteSeparationRequest,
  getSeparation,
  startSeparation,
} from "@/api/endpoints/separation";
import { guardedQueryFn } from "@/api/queries/common";
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { useAuthReady } from "@/auth/guard";
import type { SeparationService, SeparationStatus } from "@/contracts/separation";
import type { FsNodeId, SongId } from "@/domain/ids";
import type { SongSeparationStatus } from "@/domain/song";
import { getPlayerEngine } from "@/player/register";
import { projectSeparation } from "./projection";

export const SEPARATION_POLL_MS = 3_000;

/**
 * Stems already pushed into the engine, keyed by song id. patchQueueSong is
 * idempotent, but the library-list invalidation must fire exactly once per
 * completed run, not on every observer mount.
 */
const appliedStems = new Map<number, string>();

const applyReadyStems = (
  songId: SongId,
  vocals: FsNodeId,
  instrumental: FsNodeId,
): void => {
  const signature = `${vocals}:${instrumental}`;
  if (appliedStems.get(songId) === signature) return;
  appliedStems.set(songId, signature);
  // Stale-queue reconciliation: swap the ids in place; the engine only
  // touches the audio source when the current MODE wants a stem (FR-68).
  getPlayerEngine().patchQueueSong(songId, {
    vocals_media_id: vocals,
    instrumental_media_id: instrumental,
    vocal_separation_started_at: null,
  });
  void queryClient.invalidateQueries({ queryKey: keys.songs.all });
};

/**
 * Shared status poll. Every observer of a song id lands on the same query
 * key, so react-query dedupes the fetches into one 3 s cycle. The interval
 * function parks (false) when there is no job and no stems, and stops once
 * stems are ready or the job reached complete|failed.
 */
const useSeparationStatusHook = (songId: SongId): SeparationStatus => {
  const authReady = useAuthReady();
  const key = keys.songs.separation(songId);

  const query = useQuery<SongSeparationStatus>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSeparation(songId)),
    enabled: authReady,
    refetchInterval: (q) => {
      const projection = projectSeparation(q.state.data);
      return projection.phase === "pending" || projection.phase === "processing"
        ? SEPARATION_POLL_MS
        : false;
    },
  });

  const data = query.data;
  const projection = projectSeparation(data);
  const running = projection.phase === "pending" || projection.phase === "processing";

  // Live elapsed counter: 1 s tick only while a run is active. The clock is
  // read inside the interval callback (never synchronously in the effect), so
  // a run that starts after mount shows 0:00 for at most one tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [running]);

  // Patch wiring: the moment the poll reports ready with both ids, inject
  // them into the playing queue without restarting the track.
  useEffect(() => {
    if (!data) return;
    if (data.stems_ready && data.vocals_media_id && data.instrumental_media_id) {
      applyReadyStems(songId, data.vocals_media_id, data.instrumental_media_id);
    }
  }, [data, songId]);

  const elapsedSeconds =
    running && projection.startedAtMs != null
      ? Math.max(0, Math.floor((Math.max(now, projection.startedAtMs) - projection.startedAtMs) / 1_000))
      : null;

  return {
    phase: projection.phase,
    progressPercent: running ? projection.progressPercent : null,
    elapsedSeconds,
    job: data?.job ?? null,
  };
};

const triggerSeparation = async (songId: SongId, modelId?: string): Promise<void> => {
  const job = await startSeparation(songId, modelId);
  appliedStems.delete(songId);
  // Mark the queue copy processing so cog/menu relabel immediately.
  getPlayerEngine().patchQueueSong(songId, {
    vocal_separation_started_at: job.created_at ?? new Date().toISOString(),
  });
  await queryClient.invalidateQueries({ queryKey: keys.songs.separation(songId) });
  void queryClient.invalidateQueries({ queryKey: keys.songs.all });
};

const deleteSeparation = async (songId: SongId): Promise<void> => {
  await deleteSeparationRequest(songId);
  appliedStems.delete(songId);
  getPlayerEngine().patchQueueSong(songId, {
    vocals_media_id: null,
    instrumental_media_id: null,
    vocal_separation_started_at: null,
  });
  await queryClient.invalidateQueries({ queryKey: keys.songs.separation(songId) });
  void queryClient.invalidateQueries({ queryKey: keys.songs.all });
};

export const separationService: SeparationService = {
  useSeparationStatus: useSeparationStatusHook,
  triggerSeparation,
  deleteSeparation,
};
