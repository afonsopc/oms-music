/**
 * Byte-budget eviction for the EVICTABLE tier, as a pure function.
 *
 * The TTL alone (7 days on updated_at, purgeStaleCache) was enough while the
 * only thing that wrote orphan rows was actual playback. Predictive prefetch
 * changes that: seven days of aggressive prefetching can fill a phone, and a
 * TTL is not a budget. This is the budget half.
 *
 * Two rules, and they are the whole design:
 *
 *   1. PINNED rows are never candidates. Pinned is DERIVED (the song has a
 *      dl_songs row), never stored twice, so it cannot drift out of sync with
 *      what the Downloads screen shows the user.
 *   2. Within the candidates, `predicted DESC, updatedAt ASC`: probationary
 *      rows go first regardless of age, then plain LRU. `touchFile` /
 *      `touchAndPromote` already maintain updated_at as the access clock.
 *
 * Extracted from the SQL so it can be bun-tested without SQLite: the ordering
 * is the part that is easy to get subtly wrong, and the part that silently
 * eats a user's offline library when it is wrong.
 */
import type { DownloadKind } from "@/domain/downloads";
import type { SongKey } from "@/domain/ids";

export interface EvictableRow {
  songKey: SongKey;
  kind: DownloadKind;
  sizeBytes: number;
  /** 1 = probationary (predictive, never played). */
  predicted: number;
  /** Access clock: touchFile bumps it on every replay. */
  updatedAt: number;
  /** True when a dl_songs row exists. Pinned rows are never evicted. */
  pinned: boolean;
}

export interface EvictionPlan {
  /** Rows to delete, worst-first. Delete the FILE first, then the row. */
  evict: EvictableRow[];
  /** Bytes the plan frees. */
  bytesFreed: number;
  /**
   * Of those, bytes that were prefetched and never played. `evicted /
   * written` is the waste ratio the settings overview reports; the target is
   * under 30 %, and without measuring it there is no way to tune the ladder.
   */
  predictedBytesFreed: number;
}

/**
 * Worst-first order over the evictable candidates. Exported separately from
 * the plan so a test can assert the ORDER without also asserting a budget.
 */
export const evictionOrder = (rows: readonly EvictableRow[]): EvictableRow[] =>
  rows
    .filter((row) => !row.pinned)
    .slice()
    .sort((a, b) => b.predicted - a.predicted || a.updatedAt - b.updatedAt);

/** The key shape `keep` is expressed in, matching the manager's index keys. */
export const evictionKey = (row: {
  songKey: SongKey;
  kind: DownloadKind;
}): string => `${row.songKey}::${row.kind}`;

/**
 * Deletes worst-first until the evictable tier fits under `budgetBytes`, and
 * stops the moment it does. Pinned bytes are NOT counted against the budget:
 * a user with 3 GB of downloads still gets a working cache, because the free
 * space the budget derives from is read after the pinned files already exist.
 *
 * `keep` is the set of `songKey::kind` entries the player currently has
 * loaded. They are SKIPPED without their bytes leaving the running total,
 * exactly as the Rust `evict::plan` does with its own keep set: an unlinked
 * file survives in an already-open handle, but the next load opens by path and
 * would find nothing. Without this, `purgeEvictable` (a button with no
 * confirmation, justified by "pinned is untouched") deletes the file backing
 * the song playing at that moment, because a play-cached or predicted song is
 * an orphan by definition. Not subtracting the kept bytes is what stops the
 * sweep from thinking it has already freed enough and stopping early.
 */
export const planEviction = (
  rows: readonly EvictableRow[],
  budgetBytes: number,
  keep: ReadonlySet<string> = new Set(),
): EvictionPlan => {
  const candidates = evictionOrder(rows);
  let total = 0;
  for (const row of candidates) total += row.sizeBytes;

  const evict: EvictableRow[] = [];
  let bytesFreed = 0;
  let predictedBytesFreed = 0;
  for (const row of candidates) {
    if (total <= budgetBytes) break;
    if (keep.has(evictionKey(row))) continue;
    evict.push(row);
    total -= row.sizeBytes;
    bytesFreed += row.sizeBytes;
    if (row.predicted > 0) predictedBytesFreed += row.sizeBytes;
  }
  return { evict, bytesFreed, predictedBytesFreed };
};

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const EVICTABLE_BUDGET_FRACTION = 0.1;
export const EVICTABLE_BUDGET_FLOOR = 512 * 1024 * 1024;
export const EVICTABLE_BUDGET_CEILING = 2 * 1024 * 1024 * 1024;

/**
 * clamp(0.10 * free, 512 MiB, 2 GiB). Free space is read AFTER the pinned
 * files exist, which is what makes the floor safe: even a nearly full device
 * keeps half a gigabyte of cache, and even a 512 GB device never spends more
 * than two on bytes the user never asked for.
 */
export const evictableBudgetFor = (freeBytes: number): number =>
  Math.min(
    EVICTABLE_BUDGET_CEILING,
    Math.max(EVICTABLE_BUDGET_FLOOR, Math.floor(freeBytes * EVICTABLE_BUDGET_FRACTION)),
  );

/** Per-session predictive waste ceiling on mobile (not persisted). */
export const SESSION_PREDICTIVE_BUDGET_BYTES = 300 * 1024 * 1024;
