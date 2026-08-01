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
 * The JobChannel rides the shared cable (`src/cable/**`, API.md 13.4 /
 * DESIGN 10.4: subscribe params `{ channel: "JobChannel", id, token? }`,
 * messages `{ job: Job }` on subscribe and on every change). This module
 * wires that channel itself so FR-80 does not wait on any other package's
 * boot wiring; the poll fallback alone still completes the await when the
 * socket is down.
 *
 * The cable and the REST endpoints are pulled in lazily, at the moment a
 * sync is actually requested: nothing about lyrics should drag the socket or
 * the request stack into the boot graph, and it keeps the await logic
 * testable headless.
 */
import { isApiError } from "@/domain/api";
import type { SongId } from "@/domain/ids";
import type { Job } from "@/domain/lyrics";

export const JOB_POLL_FALLBACK_MS = 10_000;

/**
 * Realtime job watcher seam. `subscribe` starts watching the job id and
 * calls `onJob` with every `{ job }` payload (snapshot included); returns
 * an unsubscribe. Defaults to the cable-backed watcher below; tests (and
 * any future transport) override it through `setJobChannelWatcher`.
 */
export type JobChannelWatcher = (jobId: string, onJob: (job: Job) => void) => () => void;

/**
 * `{ job: Job }` extraction from a raw channel payload. Anything else on
 * the wire (heartbeats, future keys) is ignored rather than trusted.
 */
export const jobFromCableMessage = (message: unknown): Job | null => {
  if (!message || typeof message !== "object") return null;
  const job = (message as { job?: unknown }).job;
  if (!job || typeof job !== "object") return null;
  return typeof (job as { id?: unknown }).id === "string" ? (job as Job) : null;
};

/**
 * Cable-backed watcher. Subscribing before the socket is welcomed is safe:
 * the client keeps the subscription map and (re)subscribes on every welcome.
 * The identifier key order is the frozen `{ channel, id }` (the server
 * echoes the exact string back).
 */
const cableJobChannelWatcher: JobChannelWatcher = (jobId, onJob) => {
  let stopped = false;
  let stop: (() => void) | null = null;
  void import("@/cable/client").then(({ getCableClient }) => {
    if (stopped) return;
    const subscription = getCableClient().subscribe(
      { channel: "JobChannel", id: jobId },
      {
        onMessage: (message) => {
          const job = jobFromCableMessage(message);
          if (job) onJob(job);
        },
      },
    );
    stop = () => subscription.unsubscribe();
  });
  return () => {
    stopped = true;
    stop?.();
    stop = null;
  };
};

let jobChannelWatcher: JobChannelWatcher = cableJobChannelWatcher;

/** `null` restores the cable-backed default. */
export const setJobChannelWatcher = (watcher: JobChannelWatcher | null): void => {
  jobChannelWatcher = watcher ?? cableJobChannelWatcher;
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
    // A watcher that answers synchronously (cable snapshot already in hand)
    // settles before this assignment, so stop it right away instead of
    // leaving the subscription dangling.
    const stopWatching = jobChannelWatcher(jobId, (job) => {
      if (isFinished(job)) settle(job);
    });
    if (settled) stopWatching();
    else unsubscribe = stopWatching;

    // Safety-net REST poll: 404 during polling = keep waiting.
    const poll = async (): Promise<void> => {
      if (settled) return;
      try {
        const { getJob } = await import("@/api/endpoints/jobs");
        if (settled) return;
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
  const { startLyricsSync } = await import("@/api/endpoints/lyrics");
  const { job_id } = await startLyricsSync(songId);
  return awaitJob(job_id, opts);
};
