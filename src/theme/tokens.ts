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

/**
 * Light palette. Neutros puros (redesenho 2026-11-04, regra do dono: preto e
 * cinzentos, sem o azulado do zinc de antes), como o omelhorsite.pt.
 */
export const lightTokens: ThemeTokens = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  popover: "#ffffff",
  popoverForeground: "#0a0a0a",
  primary: "#0a0a0a",
  primaryForeground: "#fafafa",
  secondary: "#f4f4f4",
  secondaryForeground: "#0a0a0a",
  muted: "#e8e8e8",
  mutedForeground: "#6b6b6b",
  accent: "#f4f4f4",
  accentForeground: "#0a0a0a",
  destructive: hsl(0, 84.2, 60.2),
  destructiveForeground: "#fafafa",
  success: hsl(83, 100, 24),
  successForeground: "#fafafa",
  border: "#e6e6e6",
  input: "#e6e6e6",
  ring: "#0a0a0a",
};

/** Dark palette: quase preto, superfícies em degraus de cinzento. */
export const darkTokens: ThemeTokens = {
  background: "#0a0a0a",
  foreground: "#f5f5f5",
  card: "#111111",
  cardForeground: "#f5f5f5",
  popover: "#161616",
  popoverForeground: "#f5f5f5",
  primary: "#f5f5f5",
  primaryForeground: "#0a0a0a",
  secondary: "#1a1a1a",
  secondaryForeground: "#f5f5f5",
  muted: "#262626",
  mutedForeground: "#a1a1a1",
  accent: "#1a1a1a",
  accentForeground: "#f5f5f5",
  destructive: hsl(0, 62.8, 30.6),
  destructiveForeground: "#fafafa",
  success: hsl(83, 44, 44),
  successForeground: "#fafafa",
  border: "#1f1f1f",
  input: "#262626",
  ring: "#d4d4d4",
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
 * Brand: o laranja do ícone da app. Desde o redesenho de 2026-11-04 a
 * interface é só preto e cinzentos (regra do dono); o laranja fica para a
 * marca, não para chips nem interruptores.
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
 * Gostadas. Era roxo; com a regra dos neutros (2026-11-04) o coração é
 * branco sobre um quadrado de carvão, como o resto das capas geradas.
 * Voltar ao roxo é trocar estes dois valores.
 */
export const LIKED_ACCENT = "#8a8a8a";
/** Liked artwork: carvão em degradé quase imperceptível. */
export const LIKED_GRADIENT = ["#3a3a3a", "#262626", "#141414"] as const;
/**
 * sync markers and the "Playing on X" controller strip. Both are
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
export const SPOTLIGHT_GRADIENT = ["#2e2e2e", "#1c1c1c", "#0f0f0f"] as const;

/**
 * Pure black, the base of every scrim and shadow. Scrims are deliberately
 * scheme-INDEPENDENT: they darken photos and identity gradients, which are
 * the same in both schemes, and their on-color comes from `onColor`.
 */
export const SCRIM_BASE = "#000000";

// ---------------------------------------------------------------------------
// Mix and radio kind gradients (client-owned; the server `gradient` field is
// deliberately ignored). Desde 2026-11-04 são rampas de cinzento (regra dos
// neutros): a identidade de cada mix está no carimbo e na foto, não na cor.
// ---------------------------------------------------------------------------

export interface KindGradient {
  colors: readonly [string, string, string];
  accent: string;
  icon: "sparkles" | "music" | "clock" | "compass" | "radio" | "disc" | "heart";
}

export const MIX_KIND_GRADIENTS: Record<MixKind, KindGradient> = {
  top_artist: {
    colors: ["#3a3a3a", "#242424", "#121212"],
    accent: "#d4d4d4",
    icon: "sparkles",
  },
  // "This Is <artista>" (dono, 2026-08-17): essenciais por plays, o idioma
  // das apps de referencia - a moldura clara com a foto do artista vem do MixTile.
  this_is: {
    colors: ["#2b2b2b", "#1d1d1d", "#0e0e0e"],
    accent: "#e5e5e5",
    icon: "disc",
  },
  monthly_rewind: {
    colors: ["#363636", "#222222", "#111111"],
    accent: "#cfcfcf",
    icon: "heart",
  },
  year_mix: {
    colors: ["#404040", "#262626", "#141414"],
    accent: "#d9d9d9",
    icon: "sparkles",
  },
  repeat_rewind: {
    colors: ["#333333", "#202020", "#0f0f0f"],
    accent: "#c7c7c7",
    icon: "music",
  },
  time_capsule: {
    colors: ["#2f2f2f", "#1f1f1f", "#101010"],
    accent: "#bfbfbf",
    icon: "clock",
  },
  discoveries: {
    colors: ["#383838", "#232323", "#131313"],
    accent: "#d1d1d1",
    icon: "compass",
  },
};

/** Radio kind accents: artist radios share the top_artist family, song
 *  radios the repeat_rewind family (screens-content.md section 13). */
export const RADIO_KIND_GRADIENTS: Record<"artist" | "song", KindGradient> = {
  artist: {
    colors: ["#3a3a3a", "#242424", "#121212"],
    accent: "#d4d4d4",
    icon: "radio",
  },
  song: {
    colors: ["#333333", "#202020", "#0f0f0f"],
    accent: "#c7c7c7",
    icon: "radio",
  },
};
