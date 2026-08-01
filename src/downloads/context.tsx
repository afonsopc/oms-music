/**
 * DownloadStatusContext (frozen contract, DESIGN 9.3 / FR-82). Rows read
 * `getStatus`/`getProgress` SYNCHRONOUSLY and never subscribe per row; the ONE
 * coarse version counter (downloads/status.ts, throttled to ~4 Hz) is what
 * makes a list refresh.
 *
 * The provider therefore holds a STABLE context value: it re-renders only when
 * `showOnlyDownloaded` flips (a property of the contract, so its identity must
 * change). Progress bursts never re-render the tree - list containers
 * subscribe to the counter themselves through ui/downloadStatus.
 *
 * `download`/`downloadMany` never reject: a WiFi refusal (FR-88) or a failed
 * enqueue is reported through the notice channel so `void api.download(song)`
 * call sites in other packages cannot produce unhandled rejections.
 */
import React, { createContext, useContext, useMemo } from "react";
import type { SongDownloadStatus } from "@/domain/downloads";
import type { SongId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import {
  isOfflineCollection as isOfflineCollectionKey,
  toggleOfflineCollection as toggleCollection,
  downloadSongsSequentially,
} from "./collections";
import {
  downloadSong,
  getProgressFor,
  getStatusFor,
  removeDownload,
  storageUsage,
  isWifiRefusedError,
} from "./manager";
import { NOTICE_KEYS, notifyDownloadNotice } from "./notices";
import { getDownloadSettings, updateDownloadSettings, useDownloadSettings } from "./settings";
import { subscribeDownloadStatus } from "./status";

/** The frozen API (DESIGN 9.3). */
export interface DownloadStatusApi {
  getStatus(songId: SongId | SongKey | number | string): SongDownloadStatus;
  getProgress(songId: SongId | SongKey | number | string): number;
  subscribe(cb: () => void): () => void;
  download(song: Song): Promise<void>;
  downloadMany(songs: Song[]): Promise<void>;
  remove(songId: SongId | SongKey | number | string): Promise<void>;
  isOfflineCollection(key: string): boolean;
  toggleOfflineCollection(key: string, songs: Song[]): Promise<void>;
  showOnlyDownloaded: boolean;
  setShowOnlyDownloaded(v: boolean): void;
  storageUsageBytes(): Promise<number>;
}

const download = async (song: Song): Promise<void> => {
  try {
    await downloadSong(song);
  } catch (error) {
    notifyDownloadNotice(
      isWifiRefusedError(error) ? NOTICE_KEYS.wifiRefused : NOTICE_KEYS.enqueueFailed,
    );
  }
};

const downloadMany = async (songs: Song[]): Promise<void> => {
  await downloadSongsSequentially(songs);
};

const remove = async (songId: SongId | SongKey | number | string): Promise<void> => {
  await removeDownload(songId);
};

const storageUsageBytes = async (): Promise<number> => (await storageUsage()).bytes;

const setShowOnlyDownloaded = (value: boolean): void => {
  updateDownloadSettings({ showOnlyDownloaded: value });
};

/** Everything except the reactive `showOnlyDownloaded` property. */
const stableApi = {
  getStatus: getStatusFor,
  getProgress: getProgressFor,
  subscribe: subscribeDownloadStatus,
  download,
  downloadMany,
  remove,
  isOfflineCollection: isOfflineCollectionKey,
  toggleOfflineCollection: (key: string, songs: Song[]) => toggleCollection(key, songs),
  setShowOnlyDownloaded,
  storageUsageBytes,
};

/** Non-React access (register.ts seams, screens outside the provider). */
export const downloadsApi: DownloadStatusApi = {
  ...stableApi,
  get showOnlyDownloaded(): boolean {
    return getDownloadSettings().showOnlyDownloaded;
  },
};

const DownloadStatusContext = createContext<DownloadStatusApi>(downloadsApi);

/**
 * Mounted in the root provider stack through the shell slot registry
 * (DESIGN 2: SessionGate > DownloadStatusProvider > gesture root).
 */
export const DownloadStatusProvider = ({ children }: { children?: React.ReactNode }) => {
  const { showOnlyDownloaded } = useDownloadSettings();
  const value = useMemo<DownloadStatusApi>(
    () => ({ ...stableApi, showOnlyDownloaded }),
    [showOnlyDownloaded],
  );
  return (
    <DownloadStatusContext.Provider value={value}>{children}</DownloadStatusContext.Provider>
  );
};

export const useDownloadStatus = (): DownloadStatusApi => useContext(DownloadStatusContext);
