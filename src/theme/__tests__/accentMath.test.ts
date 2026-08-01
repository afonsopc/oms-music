import { describe, expect, it } from "bun:test";
import {
  blurhashAverageHex,
  brightenHex,
  heroAccentVariants,
  mixHex,
  saturateHex,
  songAccentVariants,
} from "../accentMath";

describe("brightenHex", () => {
  it("brightens toward white and darkens toward black", () => {
    expect(brightenHex("#000000", 100)).toBe("#ffffff");
    expect(brightenHex("#ffffff", -100)).toBe("#000000");
    expect(brightenHex("#808080", 0)).toBe("#808080");
  });
});

describe("saturateHex", () => {
  it("leaves gray untouched and desaturates to gray at -100", () => {
    expect(saturateHex("#808080", 50)).toBe("#808080");
    const gray = saturateHex("#ff0000", -100);
    const { length } = gray;
    expect(length).toBe(7);
    // r == g == b after full desaturation
    expect(gray.slice(1, 3)).toBe(gray.slice(3, 5));
    expect(gray.slice(3, 5)).toBe(gray.slice(5, 7));
  });
});

describe("mixHex", () => {
  it("returns the color at 100% and the target at 0%", () => {
    expect(mixHex("#ff0000", "#000000", 100)).toBe("#ff0000");
    expect(mixHex("#ff0000", "#000000", 0)).toBe("#000000");
    expect(mixHex("#ff0000", "#000000", 50)).toBe("#800000");
  });
});

describe("blurhashAverageHex", () => {
  it("decodes the DC component of a known blurhash", () => {
    // "00" size flag + "00" max AC, DC "0000" = black.
    expect(blurhashAverageHex("000000")).toBe("#000000");
  });

  it("rejects malformed input", () => {
    expect(() => blurhashAverageHex("abc")).toThrow();
  });
});

describe("accent variant derivations", () => {
  it("song variants: light is lighter than dark", () => {
    const { light, dark } = songAccentVariants("#3366aa");
    const luma = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(luma(light)).toBeGreaterThan(luma(dark));
  });

  it("hero variants differ from song variants (different recipe)", () => {
    const song = songAccentVariants("#3366aa");
    const hero = heroAccentVariants("#3366aa");
    expect(song.light === hero.light && song.dark === hero.dark).toBeFalsy();
  });
});
