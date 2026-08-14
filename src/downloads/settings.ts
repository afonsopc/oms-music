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
  /** Master switch for the predictive tier (owner request 2026-08-14). */
  predictiveEnabled: boolean;
  /**
   * Stricter than `wifiOnly`, and deliberately defaulted the OTHER way:
   * guessing wrong on cellular for a background guess costs the user money
   * for bytes they never asked for, while guessing wrong on an EXPLICIT
   * download only costs them bytes they did ask for. The predictive gate
   * reads `wifiOnly || predictiveWifiOnly`, so turning either on is enough.
   */
  predictiveWifiOnly: boolean;
  /** null = the computed clamp(0.10 * free, 512 MiB, 2 GiB) default. */
  evictableBudgetBytes: number | null;
}

const KV_KEY = "oms-music.download-settings";

const DEFAULTS: DownloadSettings = {
  wifiOnly: false,
  includeStems: true,
  showOnlyDownloaded: false,
  predictiveEnabled: true,
  predictiveWifiOnly: true,
  evictableBudgetBytes: null,
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
