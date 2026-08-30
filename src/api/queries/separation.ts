/**
 * Base separation query (no polling defaults here - the shared 3s poll with
 * no-job-no-stems parking is WP11's service, built on this hook via the
 * contracts/separation interface). Terminal statuses are complete|failed
 * ONLY (no "canceled" exists server-side).
 */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SongId } from "@/domain/ids";
import type { SongSeparationStatus, VocalSeparation } from "@/domain/song";

export const startSeparation = (songId: SongId, modelId?: string): Promise<VocalSeparation> =>
  oms().music.songs.startSeparation(songId, { modelId }) as Promise<VocalSeparation>;

export const getSeparation = (songId: SongId): Promise<SongSeparationStatus> =>
  oms().music.songs.separation(songId) as Promise<SongSeparationStatus>;

/** Deletes both stems; the original audio is kept. */
export const deleteSeparation = (songId: SongId): Promise<void> =>
  oms().music.songs.deleteSeparation(songId);

export const useSongSeparation = (
  songId: SongId | null,
  opts: { enabled?: boolean; refetchInterval?: number | false } = {},
) => {
  const authReady = useAuthReady();
  const key = songId != null ? keys.songs.separation(songId) : ["songs", "separation", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSeparation(songId as SongId)),
    enabled: authReady && (opts.enabled ?? true) && songId != null,
    refetchInterval: opts.refetchInterval ?? false,
  });
};
