/**
 * Base separation query (no polling defaults here - the shared 3s poll with
 * no-job-no-stems parking is WP11's service, built on this hook via the
 * contracts/separation interface).
 */
import { useQuery } from "@tanstack/react-query";
import { getSeparation } from "../endpoints/separation";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SongId } from "@/domain/ids";

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
