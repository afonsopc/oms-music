/**
 * Gradient recipes (DESIGN 11). Player/now-playing surfaces sit on a vertical
 * gradient of the song accent mixed toward white (light theme) or black
 * (dark); hero headers use the hero accent variant. Mix percentages port the
 * web's MusicGradient stops (oklab mixing approximated in sRGB).
 */
import { mixHex } from "./accentMath";

export type Scheme = "light" | "dark";

/** Player-bar / now-playing backdrop: [top, bottom] colors. */
export const playerGradient = (accent: string, scheme: Scheme): [string, string] =>
  scheme === "dark"
    ? [mixHex(accent, "#000000", 50), mixHex(accent, "#000000", 25)]
    : [mixHex(accent, "#ffffff", 30), mixHex(accent, "#ffffff", 15)];

/**
 * Hero header: vertical gradient from the hero accent to transparent.
 * RN wants both stops explicit; "transparent" renders correctly over the
 * page background.
 */
export const heroGradient = (accent: string): [string, string] => [accent, "transparent"];

/**
 * Artist hero (full-bleed photo): bottom-up scrim in the accent color -
 * solid at 0%, ~80% alpha at 25%, transparent by 90%.
 */
export const artistHeroScrim = (accent: string): [string, string, string] => [
  accent,
  `${accent}cc`,
  "transparent",
];

/** Dark scrim over mix-tile photos (dark at BOTH ends so white text reads). */
export const MIX_TILE_SCRIM = ["#00000099", "#00000033", "#000000bf"] as const;

/**
 * Bottom-up scrim over the artists-hub spotlight photo: heavy where the
 * label, the name and the controls sit, clearing by the top edge.
 */
export const SPOTLIGHT_SCRIM = ["#000000e6", "#0000008c", "#00000033"] as const;
