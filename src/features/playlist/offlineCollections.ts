/**
 * Offline-collections bridge (FR-87 consumption half, FR-93 filter half).
 * The collection screens (playlist, album) show the ActionBar keep-synced
 * toggle and honor the "show only downloaded" filter, but the real
 * implementation lives in WP8's downloads subsystem. WP8 (or WP12's boot
 * wireup) installs the live API here; the inert default renders no toggle
 * and never filters, mirroring the web where the ambient
 * DownloadStatusContext defaults to a no-op.
 */
import { useSyncExternalStore } from "react";
import type { Song } from "@/domain/song";

export interface OfflineCollectionsApi {
  /** Key: `'<playlistId>'` or `albumKey(artistSlug, album)` (FR-87). */
  isOfflineCollection(key: string): boolean;
  toggleOfflineCollection(key: string, songs: Song[]): Promise<void>;
  /** FR-93 `showOnlyDownloaded`; collection screens filter + suppress reorder. */
  getShowOnlyDownloaded(): boolean;
  /** ONE coarse subscription for both the collection set and the filter flag. */
  subscribe(cb: () => void): () => void;
}

let api: OfflineCollectionsApi | null = null;
let version = 0;
let detach: (() => void) | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const cb of listeners) cb();
};

const attach = (): void => {
  detach?.();
  detach = api
    ? api.subscribe(() => {
        version++;
        emit();
      })
    : null;
};

/** Installed by the downloads subsystem (WP8) via boot wireup. */
export const registerOfflineCollections = (next: OfflineCollectionsApi): void => {
  api = next;
  version++;
  if (listeners.size > 0) attach();
  emit();
};

export const getOfflineCollectionsApi = (): OfflineCollectionsApi | null => api;

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

/** Coarse re-render hook; read the api via getOfflineCollectionsApi(). */
export const useOfflineCollectionsVersion = (): number =>
  useSyncExternalStore(subscribe, getVersion, getVersion);
