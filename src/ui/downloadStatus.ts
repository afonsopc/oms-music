/**
 * Read-side seam for download status badges (FR-82/86). Mirrors the read
 * surface of `DownloadStatusApi` (DESIGN 9.3) so rows can read status and
 * progress SYNCHRONOUSLY with no per-row subscriptions: the table
 * subscribes ONCE to the coarse version counter and passes the bumped
 * version down as a prop.
 *
 * WP8's download manager (or boot wireup) installs the real reader via
 * `setDownloadStatusReader`; the inert default reports "none" so the web
 * parity surfaces render no badge until downloads exist.
 */
import { useSyncExternalStore } from "react";
import type { SongDownloadStatus } from "@/domain/downloads";

export interface DownloadStatusReader {
  /** Reads the "mixed" kind only, per the DownloadStatusApi contract. */
  getStatus(songId: number | string): SongDownloadStatus;
  /** 0..1 */
  getProgress(songId: number | string): number;
  /** ONE coarse version counter, throttled by the producer (~4 Hz). */
  subscribe(cb: () => void): () => void;
}

const inertReader: DownloadStatusReader = {
  getStatus: () => "none",
  getProgress: () => 0,
  subscribe: () => () => {},
};

let reader: DownloadStatusReader = inertReader;
let version = 0;
let detach: (() => void) | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const cb of listeners) cb();
};

const attach = (): void => {
  detach?.();
  detach = reader.subscribe(() => {
    version++;
    emit();
  });
};

/** Installed by the downloads subsystem (WP8) at boot. */
export const setDownloadStatusReader = (next: DownloadStatusReader): void => {
  reader = next;
  version++;
  if (listeners.size > 0) attach();
  emit();
};

export const getDownloadStatusReader = (): DownloadStatusReader => reader;

const subscribe = (cb: () => void): (() => void) => {
  if (listeners.size === 0) attach();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
};

const getVersion = (): number => version;

/**
 * The ONE subscription point: call it in the list container (SongTable),
 * pass the returned version to rows so memoized rows refresh coarsely.
 */
export const useDownloadStatusVersion = (): number =>
  useSyncExternalStore(subscribe, getVersion, getVersion);
