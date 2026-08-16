/**
 * Download settings (FR-93): wifiOnly (default off), includeStems (default
 * on), showOnlyDownloaded (default off). Device-level, persisted in
 * expo-sqlite/kv-store (DESIGN 9.1), reactive via one subscription channel.
 *
 * Defaults are VERSIONED (SETTINGS_VERSION): because every write persists the
 * whole object, a changed default would otherwise never reach anyone who had
 * already touched a single toggle.
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
   * Stricter than `wifiOnly`. It used to default ON, on the reasoning that a
   * wrong background guess spends cellular bytes nobody asked for; the owner
   * asked for it OFF on 2026-08-16, because a prefetch that only ever runs on
   * WiFi is not a prefetch on a phone that lives on 5G, and the predictive
   * tier was silently doing nothing all day. `wifiOnly` still covers the
   * cautious case: the gate reads `wifiOnly || predictiveWifiOnly`, so
   * turning either on is enough.
   */
  predictiveWifiOnly: boolean;
  /** null = the computed clamp(0.10 * free, 512 MiB, 2 GiB) default. */
  evictableBudgetBytes: number | null;
}

const KV_KEY = "oms-music.download-settings";
/**
 * Bumped when a DEFAULT changes in a way existing installs must adopt.
 *
 * `updateDownloadSettings` persists the WHOLE object, so the first time a
 * user flips any toggle - including the ones written for them by the library
 * view (`showOnlyDownloaded`) and the player cog (`includeStems`) - every key
 * freezes into storage and later default changes can never reach them. That
 * is why the owner saw all three of the 2026-08-16 values wrong even though
 * two of them were already correct in DEFAULTS here.
 */
const SETTINGS_VERSION = 2;
const VERSION_KEY = "oms-music.download-settings.version";

/**
 * The keys a version bump re-asserts. Deliberately NOT the whole object: a
 * migration that restored every default would throw away deliberate choices
 * (`wifiOnly`, the eviction budget) that no report asked to change.
 */
const MIGRATED_KEYS = ["includeStems", "predictiveEnabled", "predictiveWifiOnly"] as const;

const DEFAULTS: DownloadSettings = {
  wifiOnly: false,
  includeStems: true,
  showOnlyDownloaded: false,
  predictiveEnabled: true,
  predictiveWifiOnly: false,
  evictableBudgetBytes: null,
};

const loadSettings = (): DownloadSettings => {
  const merged: DownloadSettings = {
    ...DEFAULTS,
    ...(kvGetJson<Partial<DownloadSettings>>(KV_KEY) ?? {}),
  };
  if ((kvGetJson<number>(VERSION_KEY) ?? 0) >= SETTINGS_VERSION) return merged;
  for (const key of MIGRATED_KEYS) merged[key] = DEFAULTS[key];
  kvSetJson(KV_KEY, merged);
  kvSetJson(VERSION_KEY, SETTINGS_VERSION);
  return merged;
};

let settings: DownloadSettings = loadSettings();

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
