/**
 * Frozen theme tokens (DESIGN.md 11). Both shadcn-style HSL palettes ported
 * verbatim from the web globals.css. `primary` is MONOCHROME: near-black on
 * light, near-white on dark (active pills, liked hearts, play FABs, active
 * toggles). Color identity comes from artwork accents and the fixed
 * gradients below, never from the token set.
 */
import type { MixKind } from "@/domain/mixes";

export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  border: string;
  input: string;
  ring: string;
}

const hsl = (h: number, s: number, l: number): string => `hsl(${h}, ${s}%, ${l}%)`;

/** Light palette (globals.css :root). */
export const lightTokens: ThemeTokens = {
  background: hsl(0, 0, 100),
  foreground: hsl(240, 10, 3.9),
  card: hsl(0, 0, 100),
  cardForeground: hsl(240, 10, 3.9),
  popover: hsl(0, 0, 100),
  popoverForeground: hsl(240, 10, 3.9),
  primary: hsl(240, 5.9, 10),
  primaryForeground: hsl(0, 0, 98),
  secondary: hsl(240, 4.8, 95.9),
  secondaryForeground: hsl(240, 5.9, 10),
  muted: hsl(240, 4.8, 90.9),
  mutedForeground: hsl(240, 3.8, 46.1),
  accent: hsl(240, 4.8, 95.9),
  accentForeground: hsl(240, 5.9, 10),
  destructive: hsl(0, 84.2, 60.2),
  destructiveForeground: hsl(0, 0, 98),
  success: hsl(83, 100, 24),
  successForeground: hsl(0, 0, 98),
  border: hsl(240, 5.9, 90),
  input: hsl(240, 5.9, 90),
  ring: hsl(240, 10, 3.9),
};

/** Dark palette (globals.css .dark). */
export const darkTokens: ThemeTokens = {
  background: hsl(240, 10, 3.9),
  foreground: hsl(0, 0, 98),
  card: hsl(240, 10, 3.9),
  cardForeground: hsl(0, 0, 98),
  popover: hsl(240, 10, 3.9),
  popoverForeground: hsl(0, 0, 98),
  primary: hsl(0, 0, 98),
  primaryForeground: hsl(240, 5.9, 10),
  secondary: hsl(240, 3.7, 15.9),
  secondaryForeground: hsl(0, 0, 98),
  muted: hsl(240, 3.7, 20.9),
  mutedForeground: hsl(240, 5, 64.9),
  accent: hsl(240, 3.7, 15.9),
  accentForeground: hsl(0, 0, 98),
  destructive: hsl(0, 62.8, 30.6),
  destructiveForeground: hsl(0, 0, 98),
  success: hsl(83, 44, 44),
  successForeground: hsl(0, 0, 98),
  border: hsl(240, 3.7, 15.9),
  input: hsl(240, 3.7, 15.9),
  ring: hsl(240, 4.9, 83.9),
};

/** Resolved scheme name. Declared here so pure modules need no React import. */
export type ResolvedScheme = "light" | "dark";

/**
 * The ONE place a scheme turns into a palette. Everything that needs tokens
 * outside React (the navigation theme, the translucent wash helpers, tests)
 * goes through this rather than reaching for a palette by name.
 */
export const tokensFor = (scheme: ResolvedScheme): ThemeTokens =>
  scheme === "dark" ? darkTokens : lightTokens;

/** Base corner radius (px). Pills and play buttons are fully round. */
export const RADIUS = 8;

// ---------------------------------------------------------------------------
// Fixed identity colors
// ---------------------------------------------------------------------------

/**
 * Brand. The app is orange, not purple: `primary` stays monochrome for text
 * and surfaces, and THIS is the color that marks something as ours - selected
 * chips, switches, the section accent.
 */
export const BRAND = "#ff7a00";
/** Darkened brand for ink on light surfaces, where #ff7a00 is too pale. */
export const BRAND_INK = "#b85200";
/** Lighter brand used by the logo. */
export const BRAND_LOGO = "#ff930f";
/** Tinted brand wash for light-scheme backgrounds. */
export const BRAND_SOFT = "#fff3e6";

/** Music section accent. */
export const MUSIC_ACCENT = BRAND;
/**
 * Liked Songs identity. Deliberately NOT the brand: the owner rejected the
 * orange repaint here - the purple heart is what "liked" has always looked
 * like, and rebranding the chrome was never meant to touch it.
 */
export const LIKED_ACCENT = "#7e22ce";
/** Liked artwork gradient: violet-700 -> purple-700 -> indigo-900. */
export const LIKED_GRADIENT = ["#6d28d9", "#7e22ce", "#312e81"] as const;
/**
 * Spotify-sync markers and the "Playing on X" controller strip. Both are
 * FILLS: as ink on the light page emerald-500 is ~2.5:1, so anything drawing
 * the marker as text, a glyph or a dot takes `statusInkFor(scheme).sync`
 * instead (theme/scheme.ts).
 */
export const EMERALD = "#059669"; // emerald-600 (strip background)
export const EMERALD_BADGE = "#10b981"; // emerald-500 (badge tint)
/** Song accent extraction fallback (FR-66). */
export const ACCENT_FALLBACK = "#FF5555";
/** Hero accent fallback. */
export const HERO_FALLBACK = "#222222";
/**
 * Artists-hub spotlight banner gradient: fuchsia-700 -> violet-700 ->
 * indigo-800 (stands in when the artist has no banner photo).
 */
export const SPOTLIGHT_GRADIENT = ["#a21caf", "#6d28d9", "#3730a3"] as const;

/**
 * Pure black, the base of every scrim and shadow. Scrims are deliberately
 * scheme-INDEPENDENT: they darken photos and identity gradients, which are
 * the same in both schemes, and their on-color comes from `onColor`.
 */
export const SCRIM_BASE = "#000000";

// ---------------------------------------------------------------------------
// Mix and radio kind gradients (client-owned; the server `gradient` field is
// deliberately ignored). Hex values ported from the web tailwind classes.
// ---------------------------------------------------------------------------

export interface KindGradient {
  colors: readonly [string, string, string];
  accent: string;
  icon: "sparkles" | "music" | "clock" | "compass" | "radio" | "disc" | "heart";
}

export const MIX_KIND_GRADIENTS: Record<MixKind, KindGradient> = {
  top_artist: {
    colors: ["#e11d48", "#c026d3", "#4338ca"], // rose-600 fuchsia-600 indigo-700
    accent: "#c026d3",
    icon: "sparkles",
  },
  // "This Is <artista>" (dono, 2026-08-17): essenciais por plays, o idioma
  // do Spotify - a moldura clara com a foto do artista vem do MixTile.
  this_is: {
    colors: ["#0f172a", "#334155", "#0ea5e9"], // slate-900 slate-700 sky-500
    accent: "#0ea5e9",
    icon: "disc",
  },
  monthly_rewind: {
    colors: ["#0ea5e9", "#6366f1", "#a21caf"], // sky-500 indigo-500 fuchsia-800
    accent: "#6366f1",
    icon: "heart",
  },
  year_mix: {
    colors: ["#f43f5e", "#d946ef", "#7c3aed"], // rose-500 fuchsia-500 violet-600
    accent: "#d946ef",
    icon: "sparkles",
  },
  repeat_rewind: {
    colors: ["#f59e0b", "#ea580c", "#be123c"], // amber-500 orange-600 rose-700
    accent: "#ea580c",
    icon: "music",
  },
  time_capsule: {
    colors: ["#10b981", "#0d9488", "#0e7490"], // emerald-500 teal-600 cyan-700
    accent: "#0d9488",
    icon: "clock",
  },
  discoveries: {
    colors: ["#0ea5e9", "#2563eb", "#6d28d9"], // sky-500 blue-600 violet-700
    accent: "#2563eb",
    icon: "compass",
  },
};

/** Radio kind accents: artist radios share the top_artist family, song
 *  radios the repeat_rewind family (screens-content.md section 13). */
export const RADIO_KIND_GRADIENTS: Record<"artist" | "song", KindGradient> = {
  artist: {
    colors: ["#e11d48", "#c026d3", "#4338ca"],
    accent: "#c026d3",
    icon: "radio",
  },
  song: {
    colors: ["#f59e0b", "#ea580c", "#be123c"],
    accent: "#ea580c",
    icon: "radio",
  },
};
