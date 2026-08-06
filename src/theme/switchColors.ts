import { BRAND, type ThemeTokens } from "./tokens";

/**
 * Colors for a platform <Switch/>.
 *
 * `tokens.primary` is deliberately MONOCHROME (near-black in light, near-white
 * in dark), which makes it the one token a switch must not use: the platform
 * draws a white thumb, so an "on" switch rendered white-on-white is invisible
 * in dark mode. That shipped, and the toggles read as blank pills on device.
 *
 * The brand orange is used instead: it separates from the white thumb in both
 * schemes and marks the control as ours. The thumb is left to the platform on
 * purpose, so the control keeps its native look and its pressed and disabled
 * states.
 */
export const switchColors = (tokens: ThemeTokens) => ({
  trackColor: { false: tokens.muted, true: BRAND },
  ios_backgroundColor: tokens.muted,
});
