import { describe, expect, it } from "bun:test";
import { lineWordTimes } from "../overlays";
import { Lyric } from "../scenes/tipografia/_lib";
import { WORD_LEAD_S, type SceneEnv, type Signal } from "../lib/scene";

const env = (over: Partial<SceneEnv>): SceneEnv =>
  ({ colors: [], colorVecs: [], title: "T", artist: "A", cover: null, coverTex: null, lyric: "", lyricWords: null,
     lyricTime: 0, lowPower: false, tier: 3, reduceMotion: false, fx: { pixel: false, dither: false }, ...over }) as SceneEnv;
const sig = { bar: 0 } as Signal;

describe("palavras da letra nas cenas", () => {
  it("lineWordTimes: as palavras, a linha inteira (whole) ou null", () => {
    const words: [number, number, string][] = [[10, 10.4, "Like"], [11.2, 12, "sugar"]];
    expect(lineWordTimes({ t: 10, end: 13, text: "Like sugar", words })).toBe(words);
    expect(lineWordTimes({ t: 10, end: 13, text: "Like sugar", words, whole: true })).toEqual([[10, 13, "Like"], [10, 13, "sugar"]]);
    expect(lineWordTimes({ t: 10, end: 13, text: "Like sugar" })).toBeNull();
    expect(lineWordTimes(null)).toBeNull();
  });

  it("Lyric usa o tempo real de cada palavra, no relógio da cena", () => {
    const lyr = new Lyric();
    // A cena vai em t=100 quando a música está em 10,0 s.
    const words: [number, number, string][] = [[10, 10.3, "Like"], [11.5, 12.4, "sugar,"], [12.9, 13.6, "baby"]];
    lyr.update(env({ lyric: "Like sugar, baby", lyricWords: words, lyricTime: 10 }), 100, sig);
    expect(lyr.n).toBe(3);
    expect(lyr.starts[1]).toBeCloseTo(101.5 - WORD_LEAD_S, 4);
    expect(lyr.shown(101.4)).toBe(1);
    expect(lyr.shown(101.5)).toBe(2);
    // Um salto na música (seek de +1 s) move as palavras no mesmo frame.
    lyr.update(env({ lyric: "Like sugar, baby", lyricWords: words, lyricTime: 12 }), 101, sig);
    expect(lyr.shown(101)).toBe(2);
    expect(lyr.starts[2]).toBeCloseTo(101.9 - WORD_LEAD_S, 4);
  });

  it("sem palavras (ou que não batem com o texto) estima pelo tamanho", () => {
    const lyr = new Lyric();
    lyr.update(env({ lyric: "um dois tres", lyricWords: null, lyricTime: 5 }), 50, sig);
    expect(lyr.starts[0]).toBe(50);
    const other = new Lyric();
    other.update(env({ lyric: "um dois tres", lyricWords: [[5, 6, "um"]], lyricTime: 5 }), 50, sig);
    expect(other.starts[0]).toBe(50);
    expect(other.starts[1]).toBeGreaterThan(50);
  });
});
