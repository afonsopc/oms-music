/**
 * Web fork of db/kv (Metro picks .web.ts): expo-sqlite has no browser build
 * in this app's setup, and everything this store holds is small string
 * values - which is exactly what window.localStorage is. Same surface, same
 * best-effort semantics (private windows may refuse writes).
 */

export const kvGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const kvSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort; in-memory state stays correct.
  }
};

export const kvRemove = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
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
