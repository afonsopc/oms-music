/**
 * Small style helpers shared across the UI kit. The token palettes are HSL
 * strings (theme/tokens.ts), so translucent overlays are expressed here as
 * scheme-aware rgba values, matching the web's foreground/5-style washes.
 */
import type { ResolvedScheme } from "@/theme/provider";

/** foreground at low alpha: hover/press washes and top-tile card fills. */
export const foregroundWash = (scheme: ResolvedScheme, alpha: number): string =>
  scheme === "dark" ? `rgba(255, 255, 255, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;

/** background at high alpha: sticky bars and floating pills. */
export const backgroundVeil = (scheme: ResolvedScheme, alpha: number): string =>
  scheme === "dark" ? `rgba(10, 10, 12, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;

/** Standard heavy shadow (play FABs, artwork, floating pill). */
export const heavyShadow = {
  shadowColor: "#000000",
  shadowOpacity: 0.25,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
} as const;

export const softShadow = {
  shadowColor: "#000000",
  shadowOpacity: 0.15,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
} as const;

/** CSS-string linear gradient for `experimental_backgroundImage`. */
export const linearGradient = (
  direction: string,
  ...stops: readonly string[]
): string => `linear-gradient(${direction}, ${stops.join(", ")})`;
