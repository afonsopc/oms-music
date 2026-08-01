/**
 * Recent searches (FR-31): persisted list, max 6, newest first, removable
 * per row. Stored in kv under the same key family as the web.
 */
import { kvGetJson, kvSetJson } from "@/db/kv";

const RECENTS_KEY = "oms.music.recent-searches.v1";
export const MAX_RECENTS = 6;

/** Pure list op: prepend + dedupe + cap (exported for reuse). */
export const pushRecentTerm = (current: readonly string[], value: string): string[] => {
  const term = value.trim();
  if (!term) return [...current];
  return [term, ...current.filter((item) => item !== term)].slice(0, MAX_RECENTS);
};

export const readRecentSearches = (): string[] => {
  const stored = kvGetJson<string[]>(RECENTS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((s): s is string => typeof s === "string").slice(0, MAX_RECENTS);
};

export const rememberSearch = (value: string): string[] => {
  const next = pushRecentTerm(readRecentSearches(), value);
  kvSetJson(RECENTS_KEY, next);
  return next;
};

export const forgetSearch = (value: string): string[] => {
  const next = readRecentSearches().filter((item) => item !== value);
  kvSetJson(RECENTS_KEY, next);
  return next;
};
