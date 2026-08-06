/**
 * Scheme resolution, kept free of react, react-native and expo-router so the
 * rules can be tested directly (theme/__tests__/scheme.test.ts) instead of
 * only through a mounted provider.
 *
 * Two rules live here, and both were bugs before:
 *  - a stored mode plus the live system scheme resolve to exactly one palette
 *    ("system" must follow the device, including a flip while the app runs);
 *  - the react-navigation color set is DERIVED from that palette rather than
 *    left on react-navigation's own default, which is the light one.
 */
import { AA_NORMAL, ensureContrast } from "./contrast";
import { EMERALD_BADGE, type ResolvedScheme, type ThemeTokens, tokensFor } from "./tokens";

export type ThemeMode = "light" | "dark" | "system";

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

/**
 * What the platform can report. Mirrors react-native's `ColorSchemeName`
 * (including "unspecified") without importing it, so this module stays pure.
 */
export type SystemScheme = "light" | "dark" | "unspecified" | null | undefined;

/**
 * Resolves a stored mode plus the live system scheme into one palette name.
 * An explicit mode always wins; "system" follows the device and treats an
 * unknown/absent system scheme as light, matching react-native's own default.
 */
export const resolveScheme = (mode: ThemeMode, systemScheme: SystemScheme): ResolvedScheme => {
  if (mode === "light" || mode === "dark") return mode;
  return systemScheme === "dark" ? "dark" : "light";
};

/** The color half of a react-navigation theme. */
export interface NavigationColors {
  primary: string;
  background: string;
  card: string;
  text: string;
  border: string;
  notification: string;
}

/**
 * Maps our tokens onto react-navigation's six colors. `background` is the
 * important one: it paints every screen container that does not spell out its
 * own `contentStyle` / `sceneStyle`.
 */
export const navigationColors = (tokens: ThemeTokens): NavigationColors => ({
  primary: tokens.primary,
  background: tokens.background,
  card: tokens.card,
  text: tokens.foreground,
  border: tokens.border,
  notification: tokens.destructive,
});

export const navigationColorsFor = (scheme: ResolvedScheme): NavigationColors =>
  navigationColors(tokensFor(scheme));

/**
 * `success`, `destructive` and the emerald sync marker are FILL tokens: the
 * palette pairs each with its own `*Foreground` text, never with the page.
 * Used directly as ink - error copy under a form, the download badge in a
 * song row, the import status glyphs, the Spotify-sync dot - they collapse:
 * dark `destructive` lands at about 2:1 on the page background and emerald
 * 500 at about 2.5:1 on the light one. These are the same colors nudged just
 * far enough to read as ink, hue intact.
 *
 * The bar is the BODY-TEXT one. The same three values carry 11-13px error
 * strings, not only glyphs, so clearing the 3:1 non-text bar is not enough;
 * and an ink that clears 4.5:1 on the page still clears 3:1 on every other
 * fill surface it can land on.
 */
export interface StatusInk {
  success: string;
  destructive: string;
  /** Spotify-sync emerald: sync dots, "synced" hints, the done progress bar. */
  sync: string;
}

/**
 * The surfaces status ink is drawn on. `page` covers background, card and
 * popover - one value each in both palettes - while `muted` is the fill
 * behind progress tracks and chips, where the page ink can fall under the
 * non-text bar (dark `destructive` reaches only 2.85:1 there).
 */
export type InkSurface = "page" | "muted";

const statusInkFrom = (tokens: ThemeTokens, surface: string): StatusInk => ({
  success: ensureContrast(tokens.success, surface, AA_NORMAL),
  destructive: ensureContrast(tokens.destructive, surface, AA_NORMAL),
  sync: ensureContrast(EMERALD_BADGE, surface, AA_NORMAL),
});

const inkSetFor = (scheme: ResolvedScheme): Record<InkSurface, StatusInk> => {
  const tokens = tokensFor(scheme);
  return {
    page: statusInkFrom(tokens, tokens.background),
    muted: statusInkFrom(tokens, tokens.muted),
  };
};

const STATUS_INK: Record<ResolvedScheme, Record<InkSurface, StatusInk>> = {
  light: inkSetFor("light"),
  dark: inkSetFor("dark"),
};

/** Precomputed per scheme and surface: safe to call on a render path. */
export const statusInkFor = (
  scheme: ResolvedScheme,
  surface: InkSurface = "page",
): StatusInk => STATUS_INK[scheme][surface];
