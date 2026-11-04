/** Aleatórios. `rand` usa Math.random; `rng(seed)` dá uma sequência repetível (mulberry32) para cenas que querem sempre o mesmo desenho. */
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Um inteiro em [0, n). */
export const randInt = (n: number, r: () => number = Math.random) => (r() * n) | 0;
export const pick = <T>(arr: readonly T[], r: () => number = Math.random): T => arr[(r() * arr.length) | 0];
