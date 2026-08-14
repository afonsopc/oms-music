/**
 * The ONE breakpoints module (plano-uma-so-app 4.2). Every width ladder in
 * the app resolves here, so a threshold change is one edit, not a grep for
 * magic numbers across TopTileGrid/AlbumGrid/roster/SongRow (the four ad-hoc
 * ladders this file replaced).
 *
 * Two families of tokens, deliberately kept apart:
 *
 *  - SHELL tokens measure the WINDOW: below `shellDesktop` the app keeps the
 *    exact mobile shell (tab bar, mini-player pill, modal player) - that is
 *    the sacred invariant; at and above it the desktop grid (topbar /
 *    sidebar / main / right panel / transport row) takes over, and at
 *    `rightPanel` the right panel earns a real column instead of a rail.
 *  - MAIN tokens measure the CONTAINER (the main pane), never the window: on
 *    a 1440px window the main pane is ~1100px, and a table that consulted
 *    the window would draw columns the pane cannot fit.
 *
 * Pure on purpose (no react-native import): bun test loads this file
 * directly. The hooks that feed it live widths are in shellLayout.tsx.
 */

export const BREAKPOINTS = {
  /** Window width where the desktop shell replaces the mobile shell. */
  shellDesktop: 900,
  /** Window width where the right panel appears; below it, a 32px rail. */
  rightPanel: 1200,
  /** Container width where the track table gains the album column. */
  mainMd: 600,
  /** Container width where the track table gains the added-at column. */
  mainLg: 765,
  /** Container width where the duration column stops being fixed-width. */
  mainXl: 1116,
  /** The main content stops growing here and centers itself. */
  contentMax: 1600,
} as const;

export type MainBucket = "sm" | "md" | "lg" | "xl";

/** Container-width bucket for the main pane (plan table 4.2). */
export const mainBucket = (containerWidth: number): MainBucket =>
  containerWidth >= BREAKPOINTS.mainXl
    ? "xl"
    : containerWidth >= BREAKPOINTS.mainLg
      ? "lg"
      : containerWidth >= BREAKPOINTS.mainMd
        ? "md"
        : "sm";

export const isDesktopShellWidth = (windowWidth: number): boolean =>
  windowWidth >= BREAKPOINTS.shellDesktop;

export const isRightPanelWidth = (windowWidth: number): boolean =>
  windowWidth >= BREAKPOINTS.rightPanel;

// ---------------------------------------------------------------------------
// Grid ladders (frozen numbers, shared source)
// ---------------------------------------------------------------------------

/**
 * Home quick-grid columns (was TopTileGrid's inline ladder). The numbers are
 * the mobile ladder exactly as shipped - phones stay at two columns, the
 * phone idiom for this control - but the input is now the CONTAINER width,
 * so on desktop the main pane (not the whole window) decides.
 */
export const topTileGridColumns = (containerWidth: number): number =>
  containerWidth >= 1280 ? 4 : containerWidth >= 1024 ? 3 : 2;

/**
 * Tile-grid columns for the artist discography and the artists roster (was
 * duplicated in AlbumGrid.tsx and roster.tsx with the same values).
 */
export const collectionGridColumns = (containerWidth: number): number =>
  containerWidth >= 1024 ? 5 : containerWidth >= 768 ? 4 : containerWidth >= 520 ? 3 : 2;

// ---------------------------------------------------------------------------
// Hero geometry and type ramp (desktop shell only)
// ---------------------------------------------------------------------------

/**
 * Desktop hero height (plan 4.3, collection row): a cap that depends on the
 * CONTAINER WIDTH, never on the window height - the mobile hero's
 * `height * 0.36` turns into a ~500px band of nothing on a 1440p monitor,
 * which is exactly the audit gap this replaces. The fraction keeps the hero
 * proportionate in a narrow pane, the clamp keeps it honest at both ends.
 * Mobile keeps the height fractions untouched (Hero.tsx branches).
 */
export const heroMinHeight = (containerWidth: number, artistBackdrop: boolean): number => {
  const fraction = artistBackdrop ? 0.34 : 0.28;
  const min = artistBackdrop ? 300 : 260;
  const max = artistBackdrop ? 440 : 360;
  return Math.min(max, Math.max(min, Math.round(containerWidth * fraction)));
};

/** The plan's 96/72/32 entity-title ramp, one rung per main bucket. */
const HERO_TITLE_RAMP: Record<MainBucket, number> = {
  sm: 32,
  md: 72,
  lg: 96,
  xl: 96,
};

export interface HeroTitleType {
  fontSize: number;
  lineHeight: number;
}

/**
 * Desktop entity-title size (plan 4.2: main-sm 32, main-md 72, main-lg 96).
 * Long titles step DOWN one rung instead of wrapping at display size - the
 * same instinct as the mobile `length > 24` rule, expressed on the ramp so
 * a 40-character playlist name never renders three lines of 96px. Line
 * height rides 4px above the size, matching the mobile hero's ratio.
 */
export const heroTitleType = (containerWidth: number, titleLength: number): HeroTitleType => {
  const ramp = [96, 72, 32] as const;
  const base = HERO_TITLE_RAMP[mainBucket(containerWidth)];
  const damped =
    titleLength > 24 ? (ramp[ramp.indexOf(base as (typeof ramp)[number]) + 1] ?? 32) : base;
  return { fontSize: damped, lineHeight: damped + 4 };
};

// ---------------------------------------------------------------------------
// Track table column gates
// ---------------------------------------------------------------------------

/**
 * The mobile shell's frozen collapse point (web `md`): below it the album
 * and added-at columns drop TOGETHER. Kept verbatim so nothing below 900px
 * of window moves; the desktop shell uses the finer mainMd/mainLg staircase
 * instead.
 */
export const MOBILE_SONG_TABLE_WIDE = 768;

export interface SongTableColumnGate {
  album: boolean;
  addedAt: boolean;
}

/**
 * Which optional track-table columns fit this container. SongRow and
 * SongTable's header must agree row-for-row, so both call this and neither
 * keeps a private ladder.
 */
export const songTableColumnGate = (
  containerWidth: number,
  desktopShell: boolean,
): SongTableColumnGate =>
  desktopShell
    ? {
        album: containerWidth >= BREAKPOINTS.mainMd,
        addedAt: containerWidth >= BREAKPOINTS.mainLg,
      }
    : {
        album: containerWidth >= MOBILE_SONG_TABLE_WIDE,
        addedAt: containerWidth >= MOBILE_SONG_TABLE_WIDE,
      };

/** The mobile shell's frozen duration cell width. Not a token; a fact. */
export const MOBILE_SONG_TABLE_DURATION_WIDTH = 44;

/**
 * Duration cell width for SongRow and the table header (plan 4.2 grid spec:
 * `[last] 120px`, and at `main-xl` the duration "stops being fixed").
 * Returns a pixel width, or null when the column should flex instead
 * (desktop >= mainXl). Mobile keeps the shipped 44px forever.
 */
export const songTableDurationWidth = (
  containerWidth: number,
  desktopShell: boolean,
): number | null => {
  if (!desktopShell) return MOBILE_SONG_TABLE_DURATION_WIDTH;
  return containerWidth >= BREAKPOINTS.mainXl ? null : 120;
};
