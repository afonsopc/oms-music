/**
 * The react-navigation theme, derived from our tokens.
 *
 * Why this file exists: every navigator that does not spell out a
 * `contentStyle` / `sceneStyle` paints its screen container with
 * `theme.colors.background`, and react-navigation's default theme is the
 * LIGHT one (`rgb(242, 242, 242)`). Without this wiring the nested (main),
 * (auth) and (player) stacks rendered on a light grey card in dark mode while
 * their contents used the dark palette - the "white mode and dark mode at the
 * same time" report, and the reason hero metadata and song titles read as
 * washed-out pale grey.
 *
 * The objects are cached per scheme so navigators keep a stable theme
 * identity across renders and only re-render on an actual scheme flip.
 */
import { DarkTheme, DefaultTheme } from "expo-router";
import { navigationColorsFor } from "./scheme";
import type { ResolvedScheme } from "./tokens";

export type NavigationTheme = typeof DefaultTheme;

export const buildNavigationTheme = (scheme: ResolvedScheme): NavigationTheme => ({
  ...(scheme === "dark" ? DarkTheme : DefaultTheme),
  dark: scheme === "dark",
  colors: navigationColorsFor(scheme),
});

const cache: Record<ResolvedScheme, NavigationTheme> = {
  light: buildNavigationTheme("light"),
  dark: buildNavigationTheme("dark"),
};

/** Stable per-scheme navigation theme (identity is safe to use as a dep). */
export const navigationThemeFor = (scheme: ResolvedScheme): NavigationTheme => cache[scheme];
