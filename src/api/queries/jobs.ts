/**
 * Job poll fallback (FR-80): ~10s REST poll where 404 during polling means
 * "keep waiting" (the JobChannel is the fast path). Done when finished_at set.
 */
import { useQuery } from "@tanstack/react-query";
import { getJob } from "../endpoints/jobs";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { isApiError } from "@/domain/api";
import type { Job } from "@/domain/lyrics";

export const JOB_POLL_MS = 10_000;

export const useJobPoll = (id: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.job(id) : ["job", "none"];
  return useQuery<Job | null>({
    queryKey: key,
    queryFn: guardedQueryFn(key, async () => {
      try {
        return await getJob(id as string);
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null; // keep waiting
        throw error;
      }
    }),
    enabled: authReady && enabled && id != null,
    refetchInterval: (query) => {
      const job = query.state.data;
      return job?.finished_at ? false : JOB_POLL_MS;
    },
  });
};
