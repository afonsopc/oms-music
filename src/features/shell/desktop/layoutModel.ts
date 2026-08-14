/**
 * Pure desktop-layout model (plano-uma-so-app 4.5): the numbers and guards
 * behind layoutPrefs.ts, kept free of React and react-native imports so bun
 * test loads them directly - layoutPrefs itself rides on kv, which pulls
 * expo-sqlite on native and is therefore untestable outside Metro.
 */
import { MAIN_MIN_WIDTH } from "./rightPanelModel";

/** Sidebar geometry: default matches the shell's shipped 280px column. */
export const SIDEBAR_WIDTH_DEFAULT = 280;
/** Narrower than this and the library rows truncate into confetti. */
export const SIDEBAR_WIDTH_MIN = 200;
/**
 * The plan clamps the LEFT divider so the main pane keeps >= 480px; a hard
 * ceiling here is the persistence-side half of that promise (the divider,
 * when it lands, clamps against the live window too).
 */
export const SIDEBAR_WIDTH_MAX = 420;

/**
 * Persisted widths pass through here on read AND write: a kv value from an
 * older build (or a hand-edited localStorage) must come back usable, never
 * as a 4px or 4000px sidebar. Non-finite input falls to the default.
 */
export const clampSidebarWidth = (width: number): number => {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
};

/**
 * The sidebar divider's snap point: a drag RELEASED below this collapses to
 * the icon rail instead of settling on an unusably thin column. Sits between
 * the rail (72) and the usable minimum (200), so the pointer crosses a real
 * dead zone before the snap - a 1px overshoot never folds the sidebar.
 */
export const SIDEBAR_COLLAPSE_THRESHOLD = 140;

/**
 * Largest width the sidebar may take in the current window: its own ceiling,
 * further capped so `sidebar + main(>=480) + panel + chrome` still fits -
 * the mirror of rightPanelModel.rightPanelWidthCeiling, with `panelFloor`
 * standing in for whatever the right column cannot shrink below (its rail
 * when shut, its minimum width when open). `gap` appears 4 times across the
 * row: outer padding on both sides plus the two column gaps.
 */
export const sidebarWidthCeiling = (
  windowWidth: number,
  panelFloor: number,
  gap: number,
): number => Math.min(SIDEBAR_WIDTH_MAX, windowWidth - panelFloor - MAIN_MIN_WIDTH - 4 * gap);

/** Transport time label: elapsed (default) or remaining (plan 4.3 row). */
export const TIME_LABEL_MODES = ["elapsed", "remaining"] as const;
export type TimeLabelMode = (typeof TIME_LABEL_MODES)[number];

export const DEFAULT_TIME_LABEL_MODE: TimeLabelMode = "elapsed";

export const isTimeLabelMode = (value: unknown): value is TimeLabelMode =>
  value === "elapsed" || value === "remaining";

/**
 * Per-collection view-mode map maintenance: the map lives under ONE kv key
 * (a key per collection would grow localStorage forever with no way to
 * enumerate them). Insertion order is the recency order - `record` deletes
 * before it sets, so a re-visited collection moves to the back - and the
 * cap drops the oldest entries first.
 */
export const COLLECTION_VIEW_MODE_CAP = 300;

export const recordViewMode = <T extends string>(
  map: Record<string, T>,
  key: string,
  mode: T,
  cap: number = COLLECTION_VIEW_MODE_CAP,
): Record<string, T> => {
  const next: Record<string, T> = {};
  for (const [existingKey, existingMode] of Object.entries(map)) {
    if (existingKey !== key) next[existingKey] = existingMode;
  }
  next[key] = mode;
  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  const trimmed: Record<string, T> = {};
  for (const keptKey of keys.slice(keys.length - cap)) {
    trimmed[keptKey] = next[keptKey]!;
  }
  return trimmed;
};
