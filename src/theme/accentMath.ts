/**
 * Pure accent color math (bun-testable). Saturate/brighten port the web's
 * lib/utils.ts helpers verbatim; the blurhash DC decode extracts the average
 * color natively (expo-image generates a [1,1] blurhash whose DC component IS
 * the sRGB average of the image).
 */

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const toHexPair = (value: number): string => clampByte(value).toString(16).padStart(2, "0");

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;

export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
};

const lightenHex = (hex: string, percentage: number): string => {
  const { r, g, b } = hexToRgb(hex);
  const amt = Math.max(0, Math.min(percentage, 100)) / 100;
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
};

const darkenHex = (hex: string, percentage: number): string => {
  const { r, g, b } = hexToRgb(hex);
  const amt = Math.max(0, Math.min(percentage, 100)) / 100;
  return rgbToHex(r - r * amt, g - g * amt, b - b * amt);
};

/** Positive brightens toward white, negative darkens toward black. */
export const brightenHex = (hex: string, percentage: number): string =>
  percentage >= 0 ? lightenHex(hex, percentage) : darkenHex(hex, -percentage);

/** Positive pushes away from gray, negative toward gray (web-parity math). */
export const saturateHex = (hex: string, percentage: number): string => {
  const { r, g, b } = hexToRgb(hex);
  const amt = Math.max(-100, Math.min(percentage, 100)) / 100;
  const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
  if (amt >= 0) {
    return rgbToHex(r + (r - gray) * amt, g + (g - gray) * amt, b + (b - gray) * amt);
  }
  return rgbToHex(r + (gray - r) * -amt, g + (gray - g) * -amt, b + (gray - b) * -amt);
};

/** Linear sRGB mix of `color` toward `target`; colorPct is the color's share. */
export const mixHex = (color: string, target: string, colorPct: number): string => {
  const a = hexToRgb(color);
  const b = hexToRgb(target);
  const t = Math.max(0, Math.min(100, colorPct)) / 100;
  return rgbToHex(
    a.r * t + b.r * (1 - t),
    a.g * t + b.g * (1 - t),
    a.b * t + b.b * (1 - t),
  );
};

// ---------------------------------------------------------------------------
// Blurhash DC decode: chars [2..6) of a blurhash encode the average color as
// a base83 24-bit sRGB value.
// ---------------------------------------------------------------------------

const BASE83 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

const decode83 = (source: string): number => {
  let value = 0;
  for (const ch of source) {
    const digit = BASE83.indexOf(ch);
    if (digit === -1) throw new Error(`Invalid base83 character: ${ch}`);
    value = value * 83 + digit;
  }
  return value;
};

/** Average color hex from any blurhash (its DC component). */
export const blurhashAverageHex = (blurhash: string): string => {
  if (blurhash.length < 6) throw new Error("Blurhash too short");
  const dc = decode83(blurhash.slice(2, 6));
  return rgbToHex((dc >> 16) & 0xff, (dc >> 8) & 0xff, dc & 0xff);
};

// ---------------------------------------------------------------------------
// The two accent derivations (FR-66 + hero variant).
// ---------------------------------------------------------------------------

export interface AccentVariants {
  light: string;
  dark: string;
}

/** Song accent: saturate +20; brighten +50 (light) / -50 (dark). */
export const songAccentVariants = (averageHex: string): AccentVariants => {
  const base = saturateHex(averageHex, 20);
  return { light: brightenHex(base, 50), dark: brightenHex(base, -50) };
};

/** Hero accent: saturation -10; brightness +40 (light) / -60 (dark). */
export const heroAccentVariants = (averageHex: string): AccentVariants => {
  const base = saturateHex(averageHex, -10);
  return { light: brightenHex(base, 40), dark: brightenHex(base, -60) };
};
