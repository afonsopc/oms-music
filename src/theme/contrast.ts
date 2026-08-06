/**
 * Pure color math behind every contrast decision (bun-testable: no react and
 * no react-native imports). It parses the three notations the app actually
 * uses - the token palettes are `hsl(h, s%, l%)` strings, the identity
 * gradients are hex, the washes and scrims are `rgba()` - so a foreground can
 * be checked against its REAL background instead of by eye.
 *
 * WCAG 2.1 relative luminance and contrast ratio. Text drawn over an
 * artwork-derived gradient cannot be reviewed statically (the color is
 * whatever the artwork averages to), so `onColor` decides at render time
 * instead of trusting a hard-coded white.
 */

export interface Rgba {
  /** 0..255 */
  r: number;
  /** 0..255 */
  g: number;
  /** 0..255 */
  b: number;
  /** 0..1 */
  a: number;
}

/** WCAG AA for body text. */
export const AA_NORMAL = 4.5;
/** WCAG AA for >= 18.66px bold / >= 24px text, and for non-text UI. */
export const AA_LARGE = 3;

/** Foreground for text on a DARK surface (identity gradients, photo scrims). */
export const ON_DARK = "#ffffff";
/** Foreground for text on a LIGHT surface. */
export const ON_LIGHT = "#09090b";

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const NAMED_COLORS: Readonly<Record<string, Rgba>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

const hexPart = (source: string): number =>
  parseInt(source.length === 1 ? `${source}${source}` : source, 16);

const parseHex = (input: string): Rgba | null => {
  const body = input.slice(1);
  if (!/^[0-9a-f]+$/.test(body)) return null;
  if (body.length === 3 || body.length === 4) {
    return {
      r: hexPart(body.slice(0, 1)),
      g: hexPart(body.slice(1, 2)),
      b: hexPart(body.slice(2, 3)),
      a: body.length === 4 ? hexPart(body.slice(3, 4)) / 255 : 1,
    };
  }
  if (body.length === 6 || body.length === 8) {
    return {
      r: hexPart(body.slice(0, 2)),
      g: hexPart(body.slice(2, 4)),
      b: hexPart(body.slice(4, 6)),
      a: body.length === 8 ? hexPart(body.slice(6, 8)) / 255 : 1,
    };
  }
  return null;
};

/** Splits the argument list of a functional notation on commas or spaces. */
const functionArgs = (input: string): string[] | null => {
  const open = input.indexOf("(");
  const close = input.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  return input
    .slice(open + 1, close)
    .split(/[,/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const parseAlpha = (raw: string | undefined): number => {
  if (raw === undefined) return 1;
  const value = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(value) ? clamp01(value) : 1;
};

const parseChannel = (raw: string): number =>
  raw.endsWith("%") ? (Number(raw.slice(0, -1)) / 100) * 255 : Number(raw);

const parseRgbFunction = (input: string): Rgba | null => {
  const args = functionArgs(input);
  if (!args || args.length < 3) return null;
  const [r, g, b] = [parseChannel(args[0]), parseChannel(args[1]), parseChannel(args[2])];
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: parseAlpha(args[3]) };
};

/** CSS hue-to-rgb, hue in degrees, s/l in 0..1. */
const hslToRgb = (h: number, s: number, l: number): { r: number; g: number; b: number } => {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(hue / 60) % 6;
  const table: readonly (readonly [number, number, number])[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r1, g1, b1] = table[sextant];
  return { r: clampByte((r1 + m) * 255), g: clampByte((g1 + m) * 255), b: clampByte((b1 + m) * 255) };
};

const parseHslFunction = (input: string): Rgba | null => {
  const args = functionArgs(input);
  if (!args || args.length < 3) return null;
  const h = Number(args[0].replace(/deg$/, ""));
  const s = Number(args[1].replace(/%$/, "")) / 100;
  const l = Number(args[2].replace(/%$/, "")) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return { ...hslToRgb(h, clamp01(s), clamp01(l)), a: parseAlpha(args[3]) };
};

/**
 * Parses any color notation the app produces. Returns null (never throws) so
 * a render path can fall back instead of crashing on an unexpected value.
 */
export const parseColor = (color: string): Rgba | null => {
  const input = color.trim().toLowerCase();
  if (input.length === 0) return null;
  const named = NAMED_COLORS[input];
  if (named) return named;
  if (input.startsWith("#")) return parseHex(input);
  if (input.startsWith("rgb")) return parseRgbFunction(input);
  if (input.startsWith("hsl")) return parseHslFunction(input);
  return null;
};

/** Serializes back to a React Native friendly `rgba()` string. */
export const toRgbaCss = ({ r, g, b, a }: Rgba): string =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${Math.round(clamp01(a) * 1000) / 1000})`;

const byteToHex = (value: number): string => clampByte(value).toString(16).padStart(2, "0");

/**
 * Serializes to `#rrggbb` (or `#rrggbbaa`). Preferred wherever the value can
 * reach the icon builder: glyphs are SVG attributes inside a data URI, and
 * hex is the notation every SVG renderer agrees on.
 */
export const toHexCss = ({ r, g, b, a }: Rgba): string =>
  `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}${a >= 1 ? "" : byteToHex(clamp01(a) * 255)}`;

/**
 * Same color at a different alpha. Used instead of `opacity` on Text so the
 * resulting color is a value the contrast helpers can actually measure.
 */
export const withAlpha = (color: string, alpha: number): string => {
  const parsed = parseColor(color);
  if (!parsed) return color;
  return toRgbaCss({ ...parsed, a: clamp01(parsed.a * clamp01(alpha)) });
};

/** Alpha compositing of `fg` over an assumed-opaque `bg` (source-over). */
export const compositeOver = (fg: Rgba, bg: Rgba): Rgba => {
  const a = clamp01(fg.a);
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
};

const channelLuminance = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG 2.1 relative luminance (alpha is ignored: composite first). */
export const relativeLuminance = ({ r, g, b }: Rgba): number =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

/** White: the base a translucent surface is flattened onto by default. */
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Flattens a possibly-translucent color onto an opaque base, giving the color
 * the eye actually receives. Pass the real base whenever it is known (a wash
 * over `tokens.background`); the default of white is the worst case for a
 * scrim laid over arbitrary artwork, which is the other place this is needed.
 */
export const flatten = (color: string, base: string = ON_DARK): string => {
  const parsed = parseColor(color);
  if (!parsed) return color;
  if (parsed.a >= 1) return color;
  const under = parseColor(base) ?? WHITE;
  return toRgbaCss(compositeOver(parsed, under.a >= 1 ? under : compositeOver(under, WHITE)));
};

/**
 * WCAG contrast ratio (1..21) of `foreground` on `background`. A translucent
 * foreground is composited over the background first, which is what the eye
 * sees; a translucent background is flattened onto white, the worst case for
 * a scrim over artwork - flatten it yourself when the real base is known. An
 * unparseable pair returns 1 so a bad value never passes a check.
 */
export const contrastRatio = (foreground: string, background: string): number => {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return 1;
  const opaqueBg = bg.a >= 1 ? bg : compositeOver(bg, WHITE);
  const opaqueFg = fg.a >= 1 ? fg : compositeOver(fg, opaqueBg);
  const l1 = relativeLuminance(opaqueFg);
  const l2 = relativeLuminance(opaqueBg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

export const meetsContrast = (
  foreground: string,
  background: string,
  minimum: number = AA_NORMAL,
): boolean => contrastRatio(foreground, background) >= minimum;

/** The candidate with the highest contrast on `background` (first wins ties). */
export const readableOn = (background: string, candidates: readonly string[]): string => {
  let best = candidates[0] ?? ON_DARK;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
};

/**
 * Readable text color for an arbitrary surface: near-white on dark surfaces,
 * near-black on light ones. This is what the identity colors (liked gradient,
 * mix-kind gradients, the section accent) and the artwork-derived hero accents
 * get their on-color from, in BOTH schemes.
 */
export const onColor = (background: string): string =>
  readableOn(background, [ON_DARK, ON_LIGHT]);

/**
 * Identity rule: keep the ink the design documents (white on the liked
 * gradient, on the mix-kind gradients, on photo scrims) as long as it clears
 * `minimum` on that surface, and only fall back to the highest-contrast
 * option when it does not. Plain `onColor` would flip brand-white stamps to
 * black on the warmer gradients purely to win a ratio the display type does
 * not need.
 */
export const preferredOn = (
  background: string,
  preferred: string,
  minimum: number = AA_NORMAL,
): string => (meetsContrast(preferred, background, minimum) ? preferred : onColor(background));

/** True when a surface is dark enough that white text is the right call. */
export const isDarkSurface = (background: string): boolean => onColor(background) === ON_DARK;

/** Linear sRGB mix; `t` is how much of `target` to take. */
const mix = (color: Rgba, target: Rgba, t: number): Rgba => ({
  r: color.r + (target.r - color.r) * t,
  g: color.g + (target.g - color.g) * t,
  b: color.b + (target.b - color.b) * t,
  a: color.a,
});

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/**
 * Nudges `color` just far enough away from `background` to clear `minimum`,
 * and no further. The hue is kept - the color is mixed toward white or black
 * (whichever the background is not), the same move `brightenHex` makes for
 * artwork accents - so an identity color stays recognisable instead of being
 * swapped for a different one.
 *
 * This exists because a fill token is not automatically an ink token: shadcn's
 * dark `destructive` is a background color, and using it as icon ink on the
 * page lands at ~2:1. Returns `color` untouched when it already passes, and
 * when it cannot be parsed.
 */
export const ensureContrast = (
  color: string,
  background: string,
  minimum: number = AA_NORMAL,
): string => {
  const parsed = parseColor(color);
  const bg = parseColor(background);
  if (!parsed || !bg) return color;
  if (contrastRatio(color, background) >= minimum) return color;

  const target = isDarkSurface(background) ? WHITE : BLACK;
  // Contrast is monotonic in `t` here (mixing toward white only raises
  // luminance, toward black only lowers it), so bisection finds the smallest
  // shift that clears the bar.
  let lo = 0;
  let hi = 1;
  if (contrastRatio(toHexCss(mix(parsed, target, hi)), background) < minimum) {
    // Even the extreme cannot reach it (a mid-grey background); take the best.
    return toHexCss(mix(parsed, target, hi));
  }
  for (let i = 0; i < 24; i++) {
    const midpoint = (lo + hi) / 2;
    if (contrastRatio(toRgbaCss(mix(parsed, target, midpoint)), background) >= minimum) {
      hi = midpoint;
    } else {
      lo = midpoint;
    }
  }
  return toRgbaCss(mix(parsed, target, hi));
};
