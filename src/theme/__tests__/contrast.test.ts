import { describe, expect, it } from "bun:test";
import {
  AA_LARGE,
  AA_NORMAL,
  compositeOver,
  contrastRatio,
  ensureContrast,
  flatten,
  isDarkSurface,
  meetsContrast,
  ON_DARK,
  ON_LIGHT,
  onColor,
  parseColor,
  preferredOn,
  readableOn,
  relativeLuminance,
  toRgbaCss,
  withAlpha,
} from "../contrast";

describe("parseColor", () => {
  it("parses every notation the app produces", () => {
    // Hex, in all four lengths.
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0a0")).toEqual({ r: 0, g: 170, b: 0, a: 1 });
    expect(parseColor("#7e22ce")).toEqual({ r: 126, g: 34, b: 206, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(128 / 255, 5);
    expect(parseColor("#0008")?.a).toBeCloseTo(136 / 255, 5);

    // The token palettes are hsl() strings.
    expect(parseColor("hsl(0, 0%, 100%)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("hsl(240, 10%, 3.9%)")).toEqual({ r: 9, g: 9, b: 11, a: 1 });

    // The washes and scrims are rgba() strings.
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });

    // Named colors the RN style props accept.
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("WHITE")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("returns null instead of throwing on anything it cannot read", () => {
    expect(parseColor("papayawhip")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("#gggggg")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  it("round-trips through toRgbaCss", () => {
    const parsed = parseColor("hsl(240, 5.9%, 10%)");
    expect(parsed).not.toBeNull();
    expect(parseColor(toRgbaCss(parsed!))).toEqual(parsed!);
  });
});

describe("withAlpha", () => {
  it("keeps the color and multiplies the alpha", () => {
    expect(parseColor(withAlpha("#ffffff", 0.5))).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor(withAlpha("rgba(0, 0, 0, 0.5)", 0.5))?.a).toBeCloseTo(0.25, 5);
  });

  it("passes an unparseable color through untouched", () => {
    expect(withAlpha("papayawhip", 0.5)).toBe("papayawhip");
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG anchors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#7e22ce", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#7e22ce"),
      10,
    );
  });

  it("composites a translucent foreground over its background first", () => {
    // White at 50% over black is mid grey, nowhere near white's 21:1.
    const diluted = contrastRatio("rgba(255, 255, 255, 0.5)", "#000000");
    expect(diluted).toBeLessThan(contrastRatio("#ffffff", "#000000"));
    expect(diluted).toBeCloseTo(contrastRatio("#808080", "#000000"), 0);
  });

  it("refuses to pass an unreadable pair", () => {
    expect(contrastRatio("papayawhip", "#000000")).toBe(1);
    expect(meetsContrast("papayawhip", "#000000")).toBe(false);
  });
});

describe("relativeLuminance / compositeOver", () => {
  it("bounds luminance at black and white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 10);
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 10);
  });

  it("composites source-over and yields an opaque result", () => {
    const out = compositeOver(
      { r: 255, g: 255, b: 255, a: 0.5 },
      { r: 0, g: 0, b: 0, a: 1 },
    );
    expect(out.a).toBe(1);
    expect(out.r).toBeCloseTo(127.5, 5);
  });
});

describe("flatten", () => {
  it("resolves a translucent color against the base it really sits on", () => {
    // The same 12% white wash reads very differently on the two pages, which
    // is why the base has to be passed rather than assumed.
    const onDark = flatten("rgba(255, 255, 255, 0.12)", "#09090b");
    const onLight = flatten("rgba(255, 255, 255, 0.12)", "#ffffff");
    expect(relativeLuminance(parseColor(onDark)!)).toBeLessThan(
      relativeLuminance(parseColor(onLight)!),
    );
  });

  it("passes an already-opaque color straight through", () => {
    expect(flatten("#7e22ce", "#000000")).toBe("#7e22ce");
  });
});

describe("ensureContrast", () => {
  it("returns the color untouched when it already passes", () => {
    expect(ensureContrast("#ffffff", "#000000", AA_NORMAL)).toBe("#ffffff");
  });

  it("nudges a failing color until it just clears the bar", () => {
    const fixed = ensureContrast("#7f1d1d", "#09090b", AA_LARGE);
    expect(contrastRatio("#7f1d1d", "#09090b")).toBeLessThan(AA_LARGE);
    expect(contrastRatio(fixed, "#09090b")).toBeGreaterThanOrEqual(AA_LARGE);
    // "Just" clears it: a minimal nudge, not a jump to white.
    expect(contrastRatio(fixed, "#09090b")).toBeLessThan(AA_LARGE + 0.5);
  });

  it("moves away from the background in the right direction", () => {
    const onDark = parseColor(ensureContrast("#7f1d1d", "#09090b", AA_NORMAL))!;
    const onLight = parseColor(ensureContrast("#fca5a5", "#ffffff", AA_NORMAL))!;
    expect(relativeLuminance(onDark)).toBeGreaterThan(
      relativeLuminance(parseColor("#7f1d1d")!),
    );
    expect(relativeLuminance(onLight)).toBeLessThan(
      relativeLuminance(parseColor("#fca5a5")!),
    );
  });

  it("keeps the hue recognisable rather than swapping the color out", () => {
    const fixed = parseColor(ensureContrast("#7f1d1d", "#09090b", AA_LARGE))!;
    expect(fixed.r).toBeGreaterThan(fixed.g);
    expect(fixed.r).toBeGreaterThan(fixed.b);
  });

  it("returns the best it can when the bar is unreachable", () => {
    // Nothing clears 21:1 against mid grey; the helper must still terminate
    // and hand back the furthest point rather than loop or throw.
    const fixed = ensureContrast("#808080", "#808080", 21);
    expect(parseColor(fixed)).not.toBeNull();
    expect(contrastRatio(fixed, "#808080")).toBeGreaterThan(1);
  });

  it("passes an unparseable color through", () => {
    expect(ensureContrast("papayawhip", "#000000")).toBe("papayawhip");
  });
});

describe("onColor / readableOn / preferredOn", () => {
  it("picks the readable extreme for a surface", () => {
    expect(onColor("#000000")).toBe(ON_DARK);
    expect(onColor("#ffffff")).toBe(ON_LIGHT);
    expect(isDarkSurface("#7e22ce")).toBe(true);
    expect(isDarkSurface("#fde68a")).toBe(false);
  });

  it("always returns the highest-contrast candidate", () => {
    const candidates = ["#ffffff", "#808080", "#000000"];
    const picked = readableOn("#111111", candidates);
    for (const candidate of candidates) {
      expect(contrastRatio(picked, "#111111")).toBeGreaterThanOrEqual(
        contrastRatio(candidate, "#111111"),
      );
    }
  });

  it("whatever onColor picks clears AA_LARGE on any surface", () => {
    // The theoretical worst case is mid grey, where neither extreme is great;
    // 3:1 is still the floor the helper has to hold.
    for (let v = 0; v <= 255; v += 5) {
      const surface = `rgb(${v}, ${v}, ${v})`;
      expect(contrastRatio(onColor(surface), surface)).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it("keeps the brand ink while it is readable and falls back when it is not", () => {
    // White stays on a dark identity surface.
    expect(preferredOn("#7e22ce", ON_DARK, AA_NORMAL)).toBe(ON_DARK);
    // On a pale surface white is unreadable, so the fallback takes over.
    expect(preferredOn("#fde68a", ON_DARK, AA_NORMAL)).toBe(ON_LIGHT);
    // The threshold is what decides: orange-600 (the repeat_rewind accent)
    // carries white for display type but not for body copy.
    expect(preferredOn("#ea580c", ON_DARK, AA_LARGE)).toBe(ON_DARK);
    expect(preferredOn("#ea580c", ON_DARK, AA_NORMAL)).toBe(ON_LIGHT);
  });
});
