/**
 * The cog's blend and EQ sliders must land on exactly the web's steps
 * (0.01 for the blend volumes, 0.5 dB for the bands) and never hand the
 * engine a value outside the range the gain law clamps to.
 */
import { describe, expect, it } from "bun:test";
import { EQ_MAX_DB, EQ_MIN_DB } from "@/player/gainLaw";
import {
  BLEND_STEP,
  dbFromFraction,
  EQ_STEP_DB,
  formatBlend,
  formatDb,
  fractionFromDb,
  quantizeBlend,
} from "../blendMath";

const isMultipleOf = (value: number, step: number): boolean =>
  Math.abs(Math.round(value / step) - value / step) < 1e-9;

describe("blend volume slider", () => {
  it("snaps to the 0.01 step and keeps the ends reachable", () => {
    expect(quantizeBlend(0)).toBe(0);
    expect(quantizeBlend(1)).toBe(1);
    expect(quantizeBlend(0.734)).toBeCloseTo(0.73, 10);
    expect(quantizeBlend(0.7351)).toBeCloseTo(0.74, 10);
  });

  it("clamps out-of-range and NaN gestures instead of forwarding them", () => {
    expect(quantizeBlend(-3)).toBe(0);
    expect(quantizeBlend(42)).toBe(1);
    expect(quantizeBlend(Number.NaN)).toBe(0);
  });

  it("only ever produces multiples of the step", () => {
    for (let i = 0; i <= 200; i++) {
      expect(isMultipleOf(quantizeBlend(i / 200), BLEND_STEP)).toBe(true);
    }
  });

  it("reads out with two decimals", () => {
    expect(formatBlend(1)).toBe("1.00");
    expect(formatBlend(0.5)).toBe("0.50");
  });
});

describe("equalizer band slider", () => {
  it("spans exactly the clamped range", () => {
    expect(dbFromFraction(0)).toBe(EQ_MIN_DB);
    expect(dbFromFraction(1)).toBe(EQ_MAX_DB);
    expect(dbFromFraction(0.5)).toBe(0);
  });

  it("snaps to the 0.5 dB step", () => {
    for (let i = 0; i <= 240; i++) {
      const db = dbFromFraction(i / 240);
      expect(isMultipleOf(db, EQ_STEP_DB)).toBe(true);
      expect(db).toBeGreaterThanOrEqual(EQ_MIN_DB);
      expect(db).toBeLessThanOrEqual(EQ_MAX_DB);
    }
  });

  it("round-trips a band value back onto its own track position", () => {
    for (let db = EQ_MIN_DB; db <= EQ_MAX_DB; db += EQ_STEP_DB) {
      expect(dbFromFraction(fractionFromDb(db))).toBeCloseTo(db, 10);
    }
  });

  it("keeps a flat band exactly at the centre, never a hair off", () => {
    expect(fractionFromDb(0)).toBe(0.5);
  });

  it("signs the readout the way the web does", () => {
    expect(formatDb(3)).toBe("+3.0 dB");
    expect(formatDb(0)).toBe("0.0 dB");
    expect(formatDb(-1.5)).toBe("-1.5 dB");
  });
});
