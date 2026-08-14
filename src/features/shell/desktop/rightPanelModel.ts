/**
 * Right panel model (plano-uma-so-app 4.3, row "Queue"): the pure half of the
 * panel - tenant identity and width arithmetic - kept free of React and
 * react-native imports so bun can test it directly.
 *
 * ONE slot, FIVE tenants, ONE persisted key: the panel is a single column
 * that always shows exactly one of Now Playing / Queue / Lyrics / Devices /
 * Friend activity. The tenant union is the closed list of what that key may
 * hold; anything else read back from storage (an old deploy, a typo, another
 * app sharing the origin) falls back to the default instead of rendering an
 * empty column.
 */

export type RightPanelTenant = "nowPlaying" | "queue" | "lyrics" | "devices" | "friends";

/** Header/rail order - the plan's naming order, Now Playing first. */
export const RIGHT_PANEL_TENANTS: readonly RightPanelTenant[] = [
  "nowPlaying",
  "queue",
  "lyrics",
  "devices",
  "friends",
];

export const RIGHT_PANEL_DEFAULT_TENANT: RightPanelTenant = "nowPlaying";

export const isRightPanelTenant = (value: string | null): value is RightPanelTenant =>
  value != null && (RIGHT_PANEL_TENANTS as readonly string[]).includes(value);

/**
 * Width bounds. The floor keeps every tenant usable (the queue's 3-column
 * table and the now-playing artwork both compose fine at 280); the ceiling
 * stops the panel from eating the main view on an ultrawide - past 480 a
 * "panel" is just a second app.
 */
export const RIGHT_PANEL_MIN_WIDTH = 280;
export const RIGHT_PANEL_MAX_WIDTH = 480;
export const RIGHT_PANEL_DEFAULT_WIDTH = 320;

/**
 * The plan's divider clamp (4.1): resizing may never squeeze the main view
 * below this. Same number as the left divider's guarantee.
 */
export const MAIN_MIN_WIDTH = 480;

/**
 * Largest width the panel may take in the current window: its own ceiling,
 * further capped so `sidebar + main(>=480) + panel + chrome` still fits.
 * `gap` appears 4 times across the row: outer padding on both sides plus the
 * two column gaps.
 */
export const rightPanelWidthCeiling = (
  windowWidth: number,
  sidebarWidth: number,
  gap: number,
): number => Math.min(RIGHT_PANEL_MAX_WIDTH, windowWidth - sidebarWidth - MAIN_MIN_WIDTH - 4 * gap);

/** Clamp a wanted width into [floor, ceiling(window)]. */
export const clampRightPanelWidth = (
  wanted: number,
  windowWidth: number,
  sidebarWidth: number,
  gap: number,
): number => {
  const ceiling = rightPanelWidthCeiling(windowWidth, sidebarWidth, gap);
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(wanted, ceiling));
};

/**
 * Stored width -> number. Anything unparseable (missing key, corrupt value)
 * is the default; out-of-bounds values are clamped here to the ABSOLUTE
 * bounds only - the window-dependent ceiling is applied at render time,
 * because the window a value was saved under is not the window it is read
 * under.
 */
export const parseRightPanelWidth = (raw: string | null): number => {
  const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return RIGHT_PANEL_DEFAULT_WIDTH;
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(parsed, RIGHT_PANEL_MAX_WIDTH));
};
