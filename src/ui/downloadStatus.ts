/**
 * Read-side seam for download status badges (FR-82/86). Mirrors the read
 * surface of `DownloadStatusApi` (DESIGN 9.3) so rows can read status and
 * progress SYNCHRONOUSLY.
 *
 * Two channels since the 2026-08-14 freeze report:
 *  - the COARSE channel bumps on status TRANSITIONS only (queued ->
 *    downloading -> done/error), which is all a badge glyph needs;
 *  - the PROGRESS channel bumps at ~1 Hz while bytes move, for the few
 *    surfaces that render a percent.
 * The badge subscribes ITSELF (leaf subscription) - the table passes no
 * version prop, so a bump re-renders ~40 tiny badges instead of ~140 full
 * rows across every mounted screen. That table-level prop was the single
 * biggest source of "the whole app freezes while a song loads".
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
  /** Coarse channel: bumps on status transitions (producer-throttled). */
  subscribe(cb: () => void): () => void;
  /** Progress channel (~1 Hz); falls back to `subscribe` when absent. */
  subscribeProgress?(cb: () => void): () => void;
}

const inertReader: DownloadStatusReader = {
  getStatus: () => "none",
  getProgress: () => 0,
  subscribe: () => () => {},
};

let reader: DownloadStatusReader = inertReader;
let version = 0;
let detachCoarse: (() => void) | null = null;
let detachProgress: (() => void) | null = null;
const listeners = new Set<() => void>();
const progressListeners = new Set<() => void>();

const emit = (set: Set<() => void>): void => {
  for (const cb of set) cb();
};

const attach = (): void => {
  detachCoarse?.();
  detachCoarse = reader.subscribe(() => {
    version++;
    emit(listeners);
    // Transitions also refresh percent surfaces (a done badge must not
    // keep showing 97%).
    emit(progressListeners);
  });
  detachProgress?.();
  detachProgress = reader.subscribeProgress
    ? reader.subscribeProgress(() => {
        version++;
        emit(progressListeners);
      })
    : null;
};

const detachAll = (): void => {
  detachCoarse?.();
  detachCoarse = null;
  detachProgress?.();
  detachProgress = null;
};

/** Installed by the downloads subsystem (WP8) at boot. */
export const setDownloadStatusReader = (next: DownloadStatusReader): void => {
  reader = next;
  version++;
  if (listeners.size + progressListeners.size > 0) attach();
  emit(listeners);
  emit(progressListeners);
};

export const getDownloadStatusReader = (): DownloadStatusReader => reader;

const manageAttachment = (): void => {
  if (listeners.size + progressListeners.size === 0) detachAll();
};

const subscribe = (cb: () => void): (() => void) => {
  if (listeners.size + progressListeners.size === 0) attach();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    manageAttachment();
  };
};

const subscribeWithProgress = (cb: () => void): (() => void) => {
  if (listeners.size + progressListeners.size === 0) attach();
  progressListeners.add(cb);
  return () => {
    progressListeners.delete(cb);
    manageAttachment();
  };
};

const getVersion = (): number => version;

/**
 * Transition-only refresh for screens that FILTER by status (offline
 * toggles, downloaded-only views). Do not thread the value into list rows -
 * the badge subscribes itself.
 */
export const useDownloadStatusVersion = (): number =>
  useSyncExternalStore(subscribe, getVersion, getVersion);

/** Leaf hook for the badge/percent surfaces: transitions + ~1 Hz progress. */
export const useDownloadBadgeVersion = (): number =>
  useSyncExternalStore(subscribeWithProgress, getVersion, getVersion);
