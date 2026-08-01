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
  statuses.set(statusKey(songKey, kind), { status, progress });
  notifyCoarse();
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
