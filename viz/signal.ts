/**
 * O sinal da música num instante: energia, quatro faixas, o impulso da
 * batida e a fase do compasso, a partir da análise pré-calculada. Sem
 * análise (ainda a chegar, ou música sem ela) há uma respiração lenta e
 * calma, para nunca ficar parado.
 */
import type { VizAnalysis, VizSection } from "./protocol";

export interface Signal {
  energy: number;
  bass: number;
  lowmid: number;
  mid: number;
  high: number;
  /** 1 no instante da batida, a cair para 0 em ~150 ms. */
  beat: number;
  /** Contagem de batidas desde o início (com fracção). */
  beatPos: number;
  /** Compasso (4 batidas) com fracção. */
  bar: number;
  /** 1 num ataque forte, a cair depressa. */
  onset: number;
  bpm: number;
  /** Há análise verdadeira por trás. */
  real: boolean;
}

export interface Decoded {
  fps: number;
  bpm: number;
  beats: Float64Array;
  onsets: Float64Array;
  env: Uint8Array;
  bands: Uint8Array[];
  sections: VizSection[];
}

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const decode = (a: VizAnalysis): Decoded => ({
  fps: a.fps,
  bpm: a.bpm ?? 120,
  beats: Float64Array.from(a.beats.map((ms) => ms / 1000)),
  onsets: Float64Array.from(a.onsets.map((ms) => ms / 1000)),
  env: b64(a.env),
  bands: a.bands.map(b64),
  sections: (a.sections ?? []).map((x) => ({ ...x, t: x.t / 1000 })),
});

/** A secção em que `t` cai (índice), ou -1 sem secções. */
export const sectionAt = (d: Decoded | null, t: number): number => {
  if (!d || d.sections.length === 0) return -1;
  let i = -1;
  for (let k = 0; k < d.sections.length; k++) {
    if (d.sections[k].t <= t) i = k;
    else break;
  }
  return i;
};

/** Índice do último elemento <= t (pesquisa binária). */
const lastAtOrBefore = (arr: Float64Array, t: number): number => {
  let lo = 0;
  let hi = arr.length - 1;
  if (hi < 0 || arr[0] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const at = (arr: Uint8Array, f: number): number => {
  if (arr.length === 0) return 0;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  const j = Math.min(arr.length - 1, i + 1);
  const k = f - Math.floor(f);
  return (arr[i] * (1 - k) + arr[j] * k) / 255;
};

export const sample = (d: Decoded | null, t: number, playing: boolean): Signal => {
  if (!d) {
    const breathe = 0.35 + 0.15 * Math.sin(t * 0.8);
    const beatPos = t * 2;
    const beat = playing ? Math.exp(-(beatPos % 1) * 6) * 0.4 : 0;
    return { energy: breathe, bass: breathe, lowmid: breathe * 0.9, mid: breathe * 0.8, high: breathe * 0.6, beat, beatPos, bar: beatPos / 4, onset: 0, bpm: 120, real: false };
  }
  const f = t * d.fps;
  const bi = lastAtOrBefore(d.beats, t);
  const lastBeat = bi >= 0 ? d.beats[bi] : 0;
  const period = 60 / d.bpm;
  const beatPos = bi >= 0 ? bi + Math.min(1, (t - lastBeat) / period) : t / period;
  const oi = lastAtOrBefore(d.onsets, t);
  const sinceOnset = oi >= 0 ? t - d.onsets[oi] : 9;
  const quiet = playing ? 1 : 0.25;
  return {
    energy: at(d.env, f) * quiet,
    bass: at(d.bands[0], f) * quiet,
    lowmid: at(d.bands[1], f) * quiet,
    mid: at(d.bands[2], f) * quiet,
    high: at(d.bands[3], f) * quiet,
    beat: playing && bi >= 0 ? Math.exp(-(t - lastBeat) / 0.15) : 0,
    beatPos,
    bar: beatPos / 4,
    onset: playing ? Math.exp(-sinceOnset / 0.08) : 0,
    bpm: d.bpm,
    real: true,
  };
};

/** Suavização assimétrica: sobe depressa, desce devagar (o ar das VU). */
export class Smoother {
  private v: Record<string, number> = {};
  step(sig: Signal, dt: number): Signal {
    const out = { ...sig };
    for (const k of ["energy", "bass", "lowmid", "mid", "high"] as const) {
      const prev = this.v[k] ?? sig[k];
      const rate = sig[k] > prev ? 18 : 4;
      const next = prev + (sig[k] - prev) * Math.min(1, dt * rate);
      this.v[k] = next;
      out[k] = next;
    }
    return out;
  }
}
