/**
 * Download settings (FR-93): wifiOnly (default off), includeStems (default
 * on), showOnlyDownloaded (default off). Device-level, persisted in
 * expo-sqlite/kv-store (DESIGN 9.1), reactive via one subscription channel.
 */
import { useSyncExternalStore } from "react";
import { kvGetJson, kvSetJson } from "@/db/kv";

export interface DownloadSettings {
  wifiOnly: boolean;
  includeStems: boolean;
  showOnlyDownloaded: boolean;
}

const KV_KEY = "oms-music.download-settings";

const DEFAULTS: DownloadSettings = {
  wifiOnly: false,
  includeStems: true,
  showOnlyDownloaded: false,
};

let settings: DownloadSettings = {
  ...DEFAULTS,
  ...(kvGetJson<Partial<DownloadSettings>>(KV_KEY) ?? {}),
};

const listeners = new Set<() => void>();

export const getDownloadSettings = (): DownloadSettings => settings;

export const updateDownloadSettings = (patch: Partial<DownloadSettings>): void => {
  settings = { ...settings, ...patch };
  kvSetJson(KV_KEY, settings);
  for (const cb of listeners) cb();
};

export const subscribeDownloadSettings = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Reactive settings read for the settings screen and the context flag. */
export const useDownloadSettings = (): DownloadSettings =>
  useSyncExternalStore(subscribeDownloadSettings, getDownloadSettings, getDownloadSettings);
