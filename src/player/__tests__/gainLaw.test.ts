/**
 * The gain law and the EQ spec are the two places where "sounds the same as
 * the web" is decidable without a device, so they are pinned here against the
 * exact numbers in frontend/lib/vocalSeparation.ts and audioEqualizer.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  clampEqBands,
  clampEqDb,
  clampStemGains,
  clampUnit,
  EQ_BAND_SPECS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  eqIsFlat,
  gainLaw,
} from "../gainLaw";

describe("gain law (web parity)", () => {
  it("stems OFF: the original carries the volume, the mixer sits at unity", () => {
    const law = gainLaw({
      masterVolume: 0.4,
      stemsActive: false,
      vocalVolume: 0.2,
      instrumentalVolume: 0.9,
    });
    expect(law.mainGain).toBe(0.4);
    expect(law.master).toBe(1);
  });

  it("stems ON: the original is muted and the mixer carries the volume", () => {
    const law = gainLaw({
      masterVolume: 0.4,
      stemsActive: true,
      vocalVolume: 0.2,
      instrumentalVolume: 0.9,
    });
    expect(law.mainGain).toBe(0);
    expect(law.master).toBe(0.4);
    expect(law.vocal).toBe(0.2);
    expect(law.instrumental).toBe(0.9);
  });

  it("both stems at 1.0 reproduce the original at unity", () => {
    const law = gainLaw({
      masterVolume: 1,
      stemsActive: true,
      vocalVolume: 1,
      instrumentalVolume: 1,
    });
    expect(law.master).toBe(1);
    expect(law.vocal).toBe(1);
    expect(law.instrumental).toBe(1);
  });

  it("clamps every input to 0..1 and never emits NaN", () => {
    const law = gainLaw({
      masterVolume: 1.7,
      stemsActive: true,
      vocalVolume: -3,
      instrumentalVolume: Number.NaN,
    });
    expect(law.master).toBe(1);
    expect(law.vocal).toBe(0);
    expect(law.instrumental).toBe(0); // NaN reads as silence, never as NaN
    expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampEqDb(Number.NaN)).toBe(0); // NaN reads as flat
  });

  it("muting the device silences BOTH paths, whichever one is live", () => {
    expect(gainLaw({ masterVolume: 0, stemsActive: false, vocalVolume: 1, instrumentalVolume: 1 }).mainGain).toBe(0);
    const on = gainLaw({ masterVolume: 0, stemsActive: true, vocalVolume: 1, instrumentalVolume: 1 });
    expect(on.mainGain).toBe(0);
    expect(on.master).toBe(0);
  });
});

describe("stem gain clamping", () => {
  it("clamps both stems into 0..1", () => {
    expect(clampStemGains({ vocal: 2, instrumental: -1 })).toEqual({
      vocal: 1,
      instrumental: 0,
    });
  });
});

describe("3-band EQ spec (FR-70)", () => {
  it("is lowshelf 120, peaking 1000 Q=1, highshelf 8000, in series", () => {
    expect(EQ_BAND_SPECS.map((b) => b.band)).toEqual(["low", "mid", "high"]);
    expect(EQ_BAND_SPECS[0]).toEqual({
      band: "low",
      type: "lowshelf",
      frequency: 120,
      q: null,
    });
    expect(EQ_BAND_SPECS[1]).toEqual({
      band: "mid",
      type: "peaking",
      frequency: 1000,
      q: 1,
    });
    expect(EQ_BAND_SPECS[2]).toEqual({
      band: "high",
      type: "highshelf",
      frequency: 8000,
      q: null,
    });
  });

  it("clamps every band to -12..+12 dB", () => {
    expect(EQ_MIN_DB).toBe(-12);
    expect(EQ_MAX_DB).toBe(12);
    expect(clampEqDb(30)).toBe(12);
    expect(clampEqDb(-30)).toBe(-12);
    expect(clampEqDb(3.5)).toBe(3.5);
    expect(clampEqBands({ low: 99, mid: -99, high: 0 })).toEqual({
      low: 12,
      mid: -12,
      high: 0,
    });
  });

  it("reports flat only when all three bands are 0 dB", () => {
    expect(eqIsFlat({ low: 0, mid: 0, high: 0 })).toBe(true);
    expect(eqIsFlat({ low: 0.5, mid: 0, high: 0 })).toBe(false);
    expect(eqIsFlat({ low: 0, mid: 0, high: -0.5 })).toBe(false);
  });
});
