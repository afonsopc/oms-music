import { describe, expect, test } from "bun:test";
import { beatGrid, buildTimeline, clipTime, findDrops, segmentAt } from "../timeline";

// 128 BPM, 3 min: calmo até aos 60 s, depois uma drop forte.
const BPM = 128;
const period = 60 / BPM;
const duration = 180;
const beats = Array.from({ length: Math.floor(duration / period) }, (_, i) => +(i * period).toFixed(3));
const fps = 25;
const env = Array.from({ length: duration * fps }, (_, i) => (i / fps < 60 ? 0.25 : 0.85));
const clips = Array.from({ length: 12 }, (_, i) => ({ duration: 4 + (i % 4), cuts: i % 2 ? [1.2, 2.5] : [] }));
const base = { duration, bpm: BPM, beats, onsets: [], env, fps, clips };

describe("montagem", () => {
  test("a mesma semente dá a mesma montagem, outra semente outra", () => {
    const a = buildTimeline({ ...base, style: "fast", seed: 42 });
    const b = buildTimeline({ ...base, style: "fast", seed: 42 });
    const c = buildTimeline({ ...base, style: "fast", seed: 43 });
    expect(a).toEqual(b);
    expect(a.segments.map((s) => s.clip)).not.toEqual(c.segments.map((s) => s.clip));
  });

  test("encontra a drop e corta mais depressa depois dela", () => {
    const drops = findDrops(beats, env, fps);
    expect(drops.length).toBe(1);
    expect(Math.abs(drops[0] - 60)).toBeLessThan(period * 2);
    const { segments } = buildTimeline({ ...base, style: "fast", seed: 1 });
    const len = (a: number, b: number) => {
      const s = segments.filter((x) => x.t0 >= a && x.t0 < b);
      return s.reduce((n, x) => n + (x.t1 - x.t0), 0) / s.length;
    };
    expect(len(70, 170)).toBeLessThan(len(5, 55) / 2);
    const drop = segments.find((s) => s.drop);
    expect(drop?.fx.flash).toBe(1);
    expect(drop?.r1).toBeGreaterThan(drop?.r0 ?? 9);
  });

  test("os cortes caem nas batidas (fora as rajadas a meia batida)", () => {
    const { segments } = buildTimeline({ ...base, style: "slow", seed: 7 });
    for (const s of segments.slice(1)) {
      const k = s.t0 / period;
      expect(Math.abs(k - Math.round(k)) < 0.02 || Math.abs(k * 2 - Math.round(k * 2)) < 0.04).toBe(true);
    }
  });

  test("nunca pede ao clipe mais do que ele tem nem repete o anterior", () => {
    for (const style of ["fast", "slow", "chaos"] as const) {
      const { segments } = buildTimeline({ ...base, style, seed: 9 });
      expect(segments.length).toBeGreaterThan(20);
      segments.forEach((s, i) => {
        expect(clipTime(s, s.t1 - s.t0)).toBeLessThanOrEqual(clips[s.clip].duration + 1e-6);
        expect(s.inAt).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(s.clip).not.toBe(segments[i - 1].clip);
      });
    }
  });

  test("sem análise, uma grelha a 120 BPM", () => {
    expect(beatGrid([], null, 10).length).toBe(20);
    const { segments } = buildTimeline({ ...base, beats: [], bpm: null, env: [], style: "chaos", seed: 3 });
    expect(segments.length).toBeGreaterThan(100);
    expect(segmentAt(segments, 0)).toBe(0);
    expect(segmentAt(segments, 179.9)).toBe(segments.length - 1);
  });
});
