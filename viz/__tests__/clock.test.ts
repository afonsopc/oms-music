import { describe, expect, it } from "bun:test";
import { LyricClock, MAX_EXTRAPOLATION_S, SLEW_S } from "../clock";

const at = (s: number) => 1_000_000 + s * 1000;

describe("LyricClock", () => {
  it("extrapolates between readings and stops after the cap", () => {
    const c = new LyricClock();
    c.read({ position: 10, playing: true, key: "a" }, at(0));
    expect(c.now(at(0.5))).toBeCloseTo(10.5, 5);
    expect(c.now(at(10))).toBeCloseTo(10 + MAX_EXTRAPOLATION_S, 5);
  });

  it("ignores notifications that do not move the position (no step back)", () => {
    const c = new LyricClock();
    c.read({ position: 10, playing: true, key: "a" }, at(0));
    c.read({ position: 10, playing: true, key: "a" }, at(0.2));
    expect(c.now(at(0.2))).toBeCloseTo(10.2, 5);
  });

  it("absorbs a small disagreement without jumping, and catches up within the slew", () => {
    const c = new LyricClock();
    c.read({ position: 10, playing: true, key: "a" }, at(0));
    const before = c.now(at(0.25));
    c.read({ position: 10.2, playing: true, key: "a" }, at(0.25));
    expect(c.now(at(0.25))).toBeCloseTo(before, 5);
    let prev = before;
    for (let s = 0.26; s < 0.25 + SLEW_S; s += 0.01) {
      const v = c.now(at(s));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(c.now(at(0.25 + SLEW_S))).toBeCloseTo(10.2 + SLEW_S, 5);
  });

  it("jumps on a seek, a pause or a new song", () => {
    const c = new LyricClock();
    c.read({ position: 10, playing: true, key: "a" }, at(0));
    c.read({ position: 42, playing: true, key: "a" }, at(0.25));
    expect(c.now(at(0.25))).toBeCloseTo(42, 5);
    c.read({ position: 42.1, playing: false, key: "a" }, at(0.35));
    expect(c.now(at(5))).toBeCloseTo(42.1, 5);
    c.read({ position: 0, playing: true, key: "b" }, at(6));
    expect(c.now(at(6.1))).toBeCloseTo(0.1, 5);
  });

  it("uses the time the reading was taken (the postMessage delay does not count)", () => {
    const c = new LyricClock(2.5);
    c.read({ position: 20, playing: true, key: "a" }, at(0));
    // chega 80 ms depois de lida
    expect(c.raw(at(0.08))).toBeCloseTo(20.08, 5);
  });

  it("applies this device's lyrics delay", () => {
    const c = new LyricClock();
    c.delayMs = 200;
    c.read({ position: 10, playing: false }, at(0));
    expect(c.now(at(0))).toBeCloseTo(9.8, 5);
    expect(c.raw(at(0))).toBe(10);
  });
});
