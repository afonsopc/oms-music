/**
 * On-demand lyrics sync generation (FR-80). Flow, ported from the web
 * `Lyrics.sync` + `Job.await`:
 *
 *   POST /lyrics/sync { song_id } -> { job_id }
 *   await the job:  JobChannel (fast path, when a watcher is registered)
 *                   + a 10 s REST poll fallback of GET /jobs/:id where a
 *                     404 during polling means "row not visible yet, keep
 *                     waiting" (WP1's jobs endpoint documents the same).
 *   done when `finished_at` is non-null; the caller refetches the lyrics on
 *   `status === "complete"`.
 *
 * The JobChannel itself lives on the cable (WP9's `src/cable/**`, DESIGN
 * 10.4: subscribe params `{ channel: "JobChannel", id, token? }`, messages
 * `{ job: Job }` on subscribe and on every change). Until that package
 * registers a watcher here, the poll fallback alone drives the await -
 * correct, just slower (the 10/h cap makes latency a non-issue).
 */
import { getJob } from "@/api/endpoints/jobs";
import { startLyricsSync } from "@/api/endpoints/lyrics";
import { isApiError } from "@/domain/api";
import type { SongId } from "@/domain/ids";
import type { Job } from "@/domain/lyrics";

export const JOB_POLL_FALLBACK_MS = 10_000;

/**
 * Realtime job watcher seam. `subscribe` starts watching the job id and
 * calls `onJob` with every `{ job }` payload (snapshot included); returns
 * an unsubscribe. WP9/WP12 register the cable-backed implementation at
 * boot via `setJobChannelWatcher`.
 */
export type JobChannelWatcher = (jobId: string, onJob: (job: Job) => void) => () => void;

let jobChannelWatcher: JobChannelWatcher | null = null;

export const setJobChannelWatcher = (watcher: JobChannelWatcher | null): void => {
  jobChannelWatcher = watcher;
};

const isFinished = (job: Job | null): job is Job => job != null && job.finished_at != null;

/**
 * Resolves with the terminal Job (finished_at set). Rejects only on fatal
 * REST errors (non-404) or when aborted through the signal.
 */
export const awaitJob = (jobId: string, opts?: { signal?: AbortSignal }): Promise<Job> =>
  new Promise<Job>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = (): void => {
      if (pollTimer != null) clearTimeout(pollTimer);
      pollTimer = null;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (opts?.signal) opts.signal.removeEventListener("abort", onAbort);
    };

    const settle = (job: Job): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(job);
    };

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    function onAbort(): void {
      fail(new Error("aborted"));
    }

    if (opts?.signal) {
      if (opts.signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      opts.signal.addEventListener("abort", onAbort);
    }

    // Fast path: the JobChannel transmits a snapshot on subscribe and a
    // payload on every status/progress change.
    if (jobChannelWatcher) {
      unsubscribe = jobChannelWatcher(jobId, (job) => {
        if (isFinished(job)) settle(job);
      });
    }

    // Safety-net REST poll: 404 during polling = keep waiting.
    const poll = async (): Promise<void> => {
      if (settled) return;
      try {
        const job = await getJob(jobId);
        if (settled) return;
        if (isFinished(job)) {
          settle(job);
          return;
        }
      } catch (error) {
        if (!(isApiError(error) && error.status === 404)) {
          fail(error);
          return;
        }
      }
      if (!settled) pollTimer = setTimeout(() => void poll(), JOB_POLL_FALLBACK_MS);
    };
    void poll();
  });

/**
 * Full FR-80 flow: enqueue + await. Returns the terminal Job; the caller
 * checks `status === "complete"` and refetches `GET /lyrics?song_id=`.
 * Errors from the POST (400 nothing-to-sync / already-synced, 429 over the
 * 10/h cap) propagate to the caller for inline display.
 */
export const generateLyricsSync = async (
  songId: SongId,
  opts?: { signal?: AbortSignal },
): Promise<Job> => {
  const { job_id } = await startLyricsSync(songId);
  return awaitJob(job_id, opts);
};
