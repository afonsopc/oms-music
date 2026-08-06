/**
 * Small style helpers shared across the UI kit. The token palettes are HSL
 * strings (theme/tokens.ts), so translucent overlays are expressed here as
 * scheme-aware rgba values, matching the web's foreground/5-style washes.
 *
 * Nothing in the kit spells out a color literal: washes and veils are derived
 * from the palettes, scrims and shadows from SCRIM_BASE. That way a token
 * change moves every surface at once, and a grep for hex codes under src/
 * stays honest.
 */
import { withAlpha } from "@/theme/contrast";
import { type ResolvedScheme, SCRIM_BASE, tokensFor } from "@/theme/tokens";

export type { ResolvedScheme };

/** foreground at low alpha: hover/press washes and top-tile card fills. */
export const foregroundWash = (scheme: ResolvedScheme, alpha: number): string =>
  withAlpha(tokensFor(scheme).foreground, alpha);

/** background at high alpha: sticky bars and floating pills. */
export const backgroundVeil = (scheme: ResolvedScheme, alpha: number): string =>
  withAlpha(tokensFor(scheme).background, alpha);

/**
 * Backdrop behind a modal or bottom sheet. Deliberately heavier in dark mode:
 * a near-black popover on a near-black page needs the page pushed further
 * back to read as a separate layer.
 */
export const modalScrim = (scheme: ResolvedScheme): string =>
  withAlpha(SCRIM_BASE, scheme === "dark" ? 0.62 : 0.45);

/**
 * Scrim over a photo or an identity gradient. Scheme-independent on purpose:
 * the surface underneath is the same in both schemes, and the text on top
 * takes its color from `onColor`.
 */
export const photoScrim = (alpha: number): string => withAlpha(SCRIM_BASE, alpha);

/** Standard heavy shadow (play FABs, artwork, floating pill). */
export const heavyShadow = {
  shadowColor: SCRIM_BASE,
  shadowOpacity: 0.25,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
} as const;

export const softShadow = {
  shadowColor: SCRIM_BASE,
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
