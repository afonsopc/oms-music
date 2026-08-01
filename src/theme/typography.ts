/**
 * Typography (DESIGN 11). Inter is the body face on the web; the native app
 * does not bundle Inter and uses the platform default for body text (visually
 * close; revisit if design review objects). Display faces are bundled:
 * Druk Wide Super (weight 900) and Cantarell (variable).
 */
import { Platform } from "react-native";
import * as Font from "expo-font";

export const FONT_DRUK_WIDE = "DrukWideSuper";
export const FONT_CANTARELL = "Cantarell";

/** Body: platform default (SF Pro / Roboto). */
export const FONT_BODY = Platform.select({ ios: "System", default: "sans-serif" }) as string;

let loadPromise: Promise<void> | null = null;

/** Idempotent; kicked off by the ThemeProvider. Failures are non-fatal. */
export const loadFonts = (): Promise<void> => {
  if (!loadPromise) {
    loadPromise = Font.loadAsync({
      [FONT_DRUK_WIDE]: require("../../assets/fonts/DrukWide-Super-Trial.otf") as number,
      [FONT_CANTARELL]: require("../../assets/fonts/Cantarell-VF.otf") as number,
    }).catch(() => {
      // Missing display fonts degrade to the system face.
    });
  }
  return loadPromise;
};

export const fontsLoaded = (): boolean =>
  Font.isLoaded(FONT_DRUK_WIDE) && Font.isLoaded(FONT_CANTARELL);

// ---------------------------------------------------------------------------
// Text style conventions (SPEC design language). Consumed by WP4's UI kit.
// ---------------------------------------------------------------------------

export const typeScale = {
  /** Hero titles: huge black-weight. */
  heroTitle: { fontSize: 34, fontWeight: "900" as const, letterSpacing: -0.5 },
  /** Section headers: 2xl bold tight. */
  sectionHeader: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.4 },
  /** Kind labels above hero titles: tiny uppercase. */
  kindLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  /** Tile titles + subtitles. */
  tileTitle: { fontSize: 14, fontWeight: "600" as const },
  tileSubtitle: { fontSize: 12 },
  /** Time labels: tabular numerals. */
  timeLabel: { fontSize: 11, fontVariant: ["tabular-nums" as const] },
} as const;
