/**
 * Paced backfill queue for the offline lyrics fetch (FR-81 write half).
 *
 * `/lyrics*` sits in a 60/min bucket shared with `/artists/*`,
 * `/artist_metadata/*` and `/music_radios/*` (API.md section 1), and the two
 * drivers that reach it are bulk: `downloadSongsSequentially` over a whole
 * playlist and `verifyAndRepair` over the entire stored library on every
 * reconnect. Both drain in a handful of microtasks, so a fire-and-forget
 * fetch per song opens hundreds of concurrent requests, 429s most of them,
 * and - because a failed fetch deliberately keeps the `unfetched` state so
 * repair retries - repeats the burst on every reconnect.
 *
 * This queue therefore runs ONE fetch at a time, at most one start per
 * MIN_GAP_MS (50/min, leaving headroom for the lyrics screen's own reads),
 * deduped per song key while in flight, and it honors a 429's Retry-After
 * before starting the next one. Everything is injectable so the pacing is
 * unit-tested off-device.
 */

/** One start per this window: 50 requests/min against a 60/min bucket. */
export const LYRICS_MIN_GAP_MS = 1_200;
/** Cap on an honored Retry-After, so a bogus header cannot park us forever. */
export const LYRICS_MAX_BACKOFF_MS = 5 * 60_000;

export interface LyricsFetchQueueDeps {
  now?(): number;
  /** Deferred start; defaults to setTimeout (handle deliberately dropped). */
  schedule?(fn: () => void, ms: number): void;
}

interface QueuedJob {
  key: string;
  run: () => Promise<void>;
}

export class LyricsFetchQueue {
  private readonly jobs: QueuedJob[] = [];
  private readonly known = new Set<string>();
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private busy = false;
  /** -Infinity so the FIRST fetch starts immediately, not one gap late. */
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private pausedUntil = Number.NEGATIVE_INFINITY;

  constructor(
    deps: LyricsFetchQueueDeps = {},
    private readonly minGapMs: number = LYRICS_MIN_GAP_MS,
  ) {
    this.now = deps.now ?? Date.now;
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        setTimeout(fn, ms);
      });
  }

  /** No-op when this song is already queued or in flight (repair re-runs). */
  enqueue(key: string, run: () => Promise<void>): void {
    if (this.known.has(key)) return;
    this.known.add(key);
    this.jobs.push({ key, run });
    this.pump();
  }

  /** Honor a 429: nothing starts before the deadline (clamped, monotonic). */
  pauseFor(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const until = this.now() + Math.min(ms, LYRICS_MAX_BACKOFF_MS);
    if (until > this.pausedUntil) this.pausedUntil = until;
  }

  /** Session teardown: drop everything still waiting. */
  clear(): void {
    this.jobs.length = 0;
    this.known.clear();
    this.pausedUntil = Number.NEGATIVE_INFINITY;
  }

  get pending(): number {
    return this.jobs.length;
  }

  private pump(): void {
    if (this.busy || this.jobs.length === 0) return;
    this.busy = true;
    const at = this.now();
    const wait = Math.max(this.lastStartAt + this.minGapMs - at, this.pausedUntil - at, 0);
    if (wait > 0) {
      this.schedule(() => this.start(), wait);
      return;
    }
    this.start();
  }

  private start(): void {
    const job = this.jobs.shift();
    if (!job) {
      this.busy = false;
      return;
    }
    // A pause raised while this one waited pushes it back out again.
    const at = this.now();
    if (at < this.pausedUntil) {
      this.jobs.unshift(job);
      this.schedule(() => this.start(), this.pausedUntil - at);
      return;
    }
    this.lastStartAt = at;
    void job
      .run()
      .catch(() => undefined)
      .then(() => {
        // Released only after settling: a failure stays retryable on the next
        // repair pass, which is what the 'unfetched' tri-state relies on.
        this.known.delete(job.key);
        this.busy = false;
        this.pump();
      });
  }
}
