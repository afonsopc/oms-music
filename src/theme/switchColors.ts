import { LIKED_ACCENT, type ThemeTokens } from "./tokens";

/**
 * Colors for a platform <Switch/>.
 *
 * `tokens.primary` is deliberately MONOCHROME (near-black in light, near-white
 * in dark), which makes it the one token a switch must not use: the platform
 * draws a white thumb, so an "on" switch rendered white-on-white is invisible
 * in dark mode. That shipped, and the toggles read as blank pills on device.
 *
 * The identity purple is used instead: it separates from the white thumb in
 * both schemes and stays on brand rather than inventing a system blue. The
 * thumb is left to the platform on purpose, so the control keeps its native
 * look and its pressed and disabled states.
 */
export const switchColors = (tokens: ThemeTokens) => ({
  trackColor: { false: tokens.muted, true: LIKED_ACCENT },
  ios_backgroundColor: tokens.muted,
});
