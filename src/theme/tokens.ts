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
 * Ronda 2 (2026-11-04, decisão final do dono): os neutros do omelhorsite.pt
 * (frontend/app/[language]/globals.css), sem cor nenhuma na interface. A cor
 * vem só das capas e da camada visual (/viz/).
 */
export const lightTokens: ThemeTokens = {
  background: "#fafafa",
  foreground: "#171717",
  card: "#ffffff",
  cardForeground: "#171717",
  popover: "#ffffff",
  popoverForeground: "#171717",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#ededed",
  secondaryForeground: "#171717",
  muted: "#e8e8e8",
  mutedForeground: "#616161",
  accent: "#ededed",
  accentForeground: "#171717",
  destructive: hsl(0, 84.2, 60.2),
  destructiveForeground: "#fafafa",
  success: hsl(140, 60, 30),
  successForeground: "#ffffff",
  border: "#dedede",
  input: "#dedede",
  ring: "#171717",
};

/** Escuro do omelhorsite: quase preto, superfícies em degraus de cinzento neutro. */
export const darkTokens: ThemeTokens = {
  background: "#0a0a0a",
  foreground: "#ebebeb",
  card: "#111111",
  cardForeground: "#ebebeb",
  popover: "#161616",
  popoverForeground: "#ebebeb",
  primary: "#ebebeb",
  primaryForeground: "#0a0a0a",
  secondary: "#212121",
  secondaryForeground: "#ebebeb",
  muted: "#2b2b2b",
  mutedForeground: "#a3a3a3",
  accent: "#212121",
  accentForeground: "#ebebeb",
  destructive: hsl(0, 62.8, 40),
  destructiveForeground: "#fafafa",
  success: hsl(140, 44, 44),
  successForeground: "#fafafa",
  border: "#262626",
  input: "#2b2b2b",
  ring: "#d4d4d4",
};

/**
 * O "destaque" passou a neutro (o dono não quer cor nos controlos): `ink` é
 * o texto/ícone activo, `fill` o fundo do botão de tocar (branco no escuro,
 * quase preto no claro) e `on` o glifo por cima.
 */
export const ACCENT = {
  dark: { ink: "#ebebeb", fill: "#ebebeb", on: "#0a0a0a" },
  light: { ink: "#171717", fill: "#171717", on: "#fafafa" },
} as const;
/** @deprecated o glifo sobre o botão depende do tema: ACCENT[scheme].on */
export const ON_ACCENT = "#0a0a0a";

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
/**
 * As Gostadas: coração neutro (branco no escuro) sobre carvão.
 * `LIKED_INK` é o coração e os detalhes; `LIKED_WASH` o fundo da coleção.
 */
export const LIKED_INK = { dark: ACCENT.dark.ink, light: ACCENT.light.ink } as const;
export const LIKED_WASH = { dark: "#1c1c1c", light: "#ededed" } as const;
export const LIKED_TINT = {
  dark: { wash: LIKED_WASH.dark, ink: LIKED_INK.dark },
  light: { wash: LIKED_WASH.light, ink: LIKED_INK.light },
} as const;
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
/**
 * Os tons das mixes (ronda 2, 2026-11-04): o preto total era deprimente.
 * Cada tipo de mix tem uma cor calma e sua; `wash` é o fundo do mosaico
 * (fundo profundo no escuro, pastel no claro) e `ink` o texto por cima, com
 * contraste AA nos dois temas (theme/__tests__/tints.test.ts).
 */
export interface SchemeTint {
  wash: string;
  ink: string;
}
export type KindTint = Record<"light" | "dark", SchemeTint>;

export const MIX_KIND_TINTS: Record<MixKind, KindTint> = {
  // azul de fim de tarde
  top_artist: { dark: { wash: "#1c2636", ink: "#b3c8ec" }, light: { wash: "#e4ecf8", ink: "#2a4670" } },
  // salva
  this_is: { dark: { wash: "#1b2820", ink: "#acd5ba" }, light: { wash: "#e3f1e8", ink: "#2c5a3e" } },
  // rosa velho
  monthly_rewind: { dark: { wash: "#2b1c23", ink: "#ebb4c5" }, light: { wash: "#f9e6ec", ink: "#7a3350" } },
  // âmbar
  year_mix: { dark: { wash: "#2a2416", ink: "#e9cf98" }, light: { wash: "#f8efdb", ink: "#6b4f1f" } },
  // lilás
  repeat_rewind: { dark: { wash: "#221c2e", ink: "#c7b8ee" }, light: { wash: "#eee8fa", ink: "#4b387e" } },
  // barro
  time_capsule: { dark: { wash: "#2a1f18", ink: "#e6bea4" }, light: { wash: "#f8e9df", ink: "#72432a" } },
  // verde-água
  discoveries: { dark: { wash: "#172828", ink: "#a2d6d3" }, light: { wash: "#e0f2f1", ink: "#22584f" } },
};

export const RADIO_KIND_TINTS: Record<"artist" | "song", KindTint> = {
  artist: MIX_KIND_TINTS.top_artist,
  song: MIX_KIND_TINTS.time_capsule,
};

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
