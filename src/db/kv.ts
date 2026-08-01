/**
 * Small-value store over expo-sqlite/kv-store: settings, locale, recent
 * searches, persisted listener settings, folder-import trackers (DESIGN 3).
 * Synchronous reads keep boot and store hydration simple.
 */
import Storage from "expo-sqlite/kv-store";

export const kvGet = (key: string): string | null => {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
};

export const kvSet = (key: string, value: string): void => {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Persistence is best-effort; in-memory state stays correct.
  }
};

export const kvRemove = (key: string): void => {
  try {
    Storage.removeItemSync(key);
  } catch {
    // Best-effort.
  }
};

export const kvGetJson = <T>(key: string): T | null => {
  const raw = kvGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const kvSetJson = (key: string, value: unknown): void => {
  kvSet(key, JSON.stringify(value));
};
