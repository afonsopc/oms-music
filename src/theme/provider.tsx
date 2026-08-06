/**
 * Theme provider: light/dark/system with persisted choice (FR-18). Consumers
 * restyle on flip without re-downloading artwork - accents are cached in
 * both variants (theme/accent.ts).
 *
 * `useColorScheme` is RN's `useSyncExternalStore` over `Appearance`, so a
 * system flip while the app is open propagates without a remount. Two things
 * hang off the resolved scheme besides the tokens, and both used to be
 * missing:
 *  - the react-navigation theme (theme/navigation.ts), which paints every
 *    screen container that does not spell out its own background;
 *  - the native root view color (expo-system-ui), which is what shows through
 *    during modal transitions and overscroll.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";
import { navigationThemeFor, type NavigationTheme } from "./navigation";
import {
  isThemeMode,
  resolveScheme,
  statusInkFor,
  type StatusInk,
  type ThemeMode,
} from "./scheme";
import { type ResolvedScheme, type ThemeTokens, tokensFor } from "./tokens";
import { loadFonts } from "./typography";
import { kvGet, kvSet } from "@/db/kv";

export { resolveScheme };
export type { ResolvedScheme, ThemeMode };

const MODE_KV_KEY = "oms-music.theme-mode";

interface ThemeContextValue {
  mode: ThemeMode;
  scheme: ResolvedScheme;
  tokens: ThemeTokens;
  /**
   * Ink variants of the status fills for the current scheme, on the page.
   * Handed out here so no screen has to remember that `tokens.destructive`
   * is a button background rather than a text color.
   */
  ink: StatusInk;
  /** react-navigation theme for the current scheme (stable identity). */
  navigationTheme: NavigationTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = kvGet(MODE_KV_KEY);
    return isThemeMode(stored) ? stored : "system";
  });
  const systemScheme = useColorScheme();

  useEffect(() => {
    void loadFonts();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    kvSet(MODE_KV_KEY, next);
  }, []);

  const scheme = resolveScheme(mode, systemScheme);
  const tokens = tokensFor(scheme);

  // The native window under the RN surface: without this it stays white and
  // flashes through during the player modal transition and on overscroll.
  // Cosmetic, so every failure mode (throw or reject) is swallowed - this
  // must never be able to block boot.
  useEffect(() => {
    try {
      void SystemUI.setBackgroundColorAsync(tokens.background).catch(() => {});
    } catch {
      // Native module unavailable (web, or a build without it linked).
    }
  }, [tokens.background]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      scheme,
      tokens,
      ink: statusInkFor(scheme),
      navigationTheme: navigationThemeFor(scheme),
      setMode,
    }),
    [mode, scheme, tokens, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
