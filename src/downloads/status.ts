/**
 * In-memory status map + the ONE coarse version counter (FR-82/86).
 * List rows read status/progress synchronously; progress events bump a
 * single counter throttled to ~4 Hz so a burst of parallel chunk callbacks
 * never turns into a per-row re-render storm (DESIGN 9.2/9.3).
 */
import type { DownloadFileStatus, DownloadKind, SongDownloadStatus } from "@/domain/downloads";
import type { SongKey } from "@/domain/ids";

const THROTTLE_MS = 250; // ~4 Hz

interface KindStatus {
  status: DownloadFileStatus;
  progress: number; // 0..1
}

const statusKey = (songKey: SongKey, kind: DownloadKind): string => `${songKey}::${kind}`;

const statuses = new Map<string, KindStatus>();
const listeners = new Set<() => void>();

let pending = false;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

const flush = (): void => {
  pending = false;
  version += 1;
  for (const cb of listeners) cb();
};

/**
 * The PROGRESS channel, split from the coarse one (owner freeze report
 * 2026-08-14): progress samples arrive at 4 Hz per transfer, but only the
 * percent surfaces (overview in-flight list, the open song menu) care.
 * Bumping the coarse counter for them re-rendered every mounted badge - and
 * through the old table-level subscription, every mounted ROW - for the
 * whole duration of every transfer, which is exactly "the app freezes while
 * a song loads". Progress consumers subscribe HERE, at 1 Hz.
 */
const progressListeners = new Set<() => void>();
let progressPending = false;
let progressTimer: ReturnType<typeof setTimeout> | null = null;
let progressVersion = 0;
const PROGRESS_THROTTLE_MS = 1_000;

const flushProgress = (): void => {
  progressPending = false;
  progressVersion += 1;
  for (const cb of progressListeners) cb();
};

const notifyProgress = (): void => {
  if (progressPending) return;
  progressPending = true;
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    if (progressPending) flushProgress();
  }, PROGRESS_THROTTLE_MS);
};

export const getProgressVersion = (): number => progressVersion;

export const subscribeDownloadProgress = (cb: () => void): (() => void) => {
  progressListeners.add(cb);
  return () => {
    progressListeners.delete(cb);
  };
};

/**
 * Coarse version counter, bumped once per notify window. useSyncExternalStore
 * snapshots must be referentially stable between changes, so subscribers read
 * THIS, never a timestamp.
 */
export const getStatusVersion = (): number => version;

/** Coalesced notify: at most one listener sweep per throttle window. */
const notifyCoarse = (): void => {
  if (pending) return;
  pending = true;
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    if (pending) flush();
  }, THROTTLE_MS);
};

export const subscribeDownloadStatus = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const setKindStatus = (
  songKey: SongKey,
  kind: DownloadKind,
  status: DownloadFileStatus,
  progress = 0,
): void => {
  const key = statusKey(songKey, kind);
  const prev = statuses.get(key);
  statuses.set(key, { status, progress });
  // Coarse bump ONLY on a status transition (none->queued->downloading->
  // done/error); a same-status progress sample feeds the progress channel.
  if (!prev || prev.status !== status) notifyCoarse();
  else notifyProgress();
};

export const clearKindStatus = (songKey: SongKey, kind: DownloadKind): void => {
  statuses.delete(statusKey(songKey, kind));
  notifyCoarse();
};

export const clearSongStatuses = (songKey: SongKey): void => {
  for (const key of statuses.keys()) {
    if (key.startsWith(`${songKey}::`)) statuses.delete(key);
  }
  notifyCoarse();
};

export const resetStatuses = (): void => {
  statuses.clear();
  notifyCoarse();
};

export const getKindStatus = (songKey: SongKey, kind: DownloadKind): KindStatus | null =>
  statuses.get(statusKey(songKey, kind)) ?? null;

/** The UI-facing read: a song's status is its "mixed" kind only (FR-83). */
export const getMixedStatus = (songKey: SongKey): SongDownloadStatus =>
  statuses.get(statusKey(songKey, "mixed"))?.status ?? "none";

export const getMixedProgress = (songKey: SongKey): number =>
  statuses.get(statusKey(songKey, "mixed"))?.progress ?? 0;
