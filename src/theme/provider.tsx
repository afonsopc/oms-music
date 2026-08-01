/**
 * Theme provider: light/dark/system with persisted choice (FR-18). Consumers
 * restyle on flip without re-downloading artwork - accents are cached in
 * both variants (theme/accent.ts).
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
import { darkTokens, lightTokens, type ThemeTokens } from "./tokens";
import { loadFonts } from "./typography";
import { kvGet, kvSet } from "@/db/kv";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

const MODE_KV_KEY = "oms-music.theme-mode";

interface ThemeContextValue {
  mode: ThemeMode;
  scheme: ResolvedScheme;
  tokens: ThemeTokens;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isMode = (value: unknown): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = kvGet(MODE_KV_KEY);
    return isMode(stored) ? stored : "system";
  });
  const systemScheme = useColorScheme();

  useEffect(() => {
    void loadFonts();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    kvSet(MODE_KV_KEY, next);
  }, []);

  const scheme: ResolvedScheme =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      scheme,
      tokens: scheme === "dark" ? darkTokens : lightTokens,
      setMode,
    }),
    [mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
