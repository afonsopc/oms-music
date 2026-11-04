/**
 * A montagem em si, sem vídeo nem ecrã: a partir da análise da música (batidas,
 * ataques, energia), dos clipes e da semente, a lista de troços: que clipe, de
 * onde, a que velocidade e com que efeitos. A mesma entrada dá sempre a mesma
 * montagem ("Outra versão" muda só a semente).
 *
 * Corta nas batidas: mais vezes com mais energia; nas subidas grandes de
 * energia (as "drops") uma rajada de cortes, clarão, zoom e cores partidas e
 * um clipe que ainda não se viu. Dentro de cada clipe prefere começar logo a
 * seguir a uma mudança de cena (o corte cai num plano novo).
 */
import type { MontageClip, MontageStyle } from "./protocol";

export interface Fx {
  /** Clarão no corte (0..1). */
  flash: number;
  /** Zoom de soco no corte (0..0.3). */
  zoom: number;
  /** Abanão (0..1). */
  shake: number;
  /** Cores partidas (0..1). */
  rgb: number;
  /** Negativo num instante (caos). */
  invert: boolean;
}

export interface Segment {
  t0: number;
  t1: number;
  clip: number;
  /** De onde começa no clipe (s). */
  inAt: number;
  /** Velocidade no início e no fim (rampa linear). */
  r0: number;
  r1: number;
  fx: Fx;
  drop: boolean;
}

export interface TimelineInput {
  duration: number;
  bpm: number | null;
  beats: number[];
  onsets: number[];
  /** Energia 0..1 a `fps` por segundo. */
  env: ArrayLike<number>;
  fps: number;
  clips: Pick<MontageClip, "duration" | "cuts">[];
  style: MontageStyle;
  seed: number;
}

export interface Timeline {
  segments: Segment[];
  drops: number[];
}

/** mulberry32: pequeno, rápido e igual em todo o lado. */
export const rng = (seed: number): (() => number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const STYLE = {
  // batidas por corte com energia baixa, média e alta
  fast: { beats: [4, 2, 1], speed: [0.9, 1.15], flash: 0.35, zoom: 0.08, shake: 0.25, rgb: 0.2, half: 0.25 },
  slow: { beats: [8, 4, 4], speed: [0.55, 0.85], flash: 0.12, zoom: 0.02, shake: 0, rgb: 0.05, half: 0 },
  chaos: { beats: [2, 1, 1], speed: [0.5, 2.0], flash: 0.6, zoom: 0.16, shake: 0.7, rgb: 0.6, half: 0.55 },
} as const;

const mean = (env: ArrayLike<number>, fps: number, a: number, b: number): number => {
  const i0 = Math.max(0, Math.floor(a * fps));
  const i1 = Math.min(env.length, Math.max(i0 + 1, Math.ceil(b * fps)));
  if (i1 <= i0) return 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += env[i];
  return s / (i1 - i0);
};

/** As batidas da análise, ou uma grelha ao BPM (120 sem nada) do princípio ao fim. */
export const beatGrid = (beats: number[], bpm: number | null, duration: number): number[] => {
  if (beats.length >= 8) {
    const out = beats.filter((b) => b >= 0 && b < duration);
    if (out[0] > 0.05) out.unshift(0);
    return out;
  }
  const period = 60 / (bpm && bpm > 40 ? bpm : 120);
  const out: number[] = [];
  for (let t = 0; t < duration; t += period) out.push(t);
  return out;
};

/**
 * As subidas grandes de energia: a média dos 2 compassos seguintes acima da
 * dos 2 anteriores por mais de `jump`, no máximo uma a cada 8 compassos. Na
 * batida da subida.
 */
export const findDrops = (grid: number[], env: ArrayLike<number>, fps: number, jump = 0.16): number[] => {
  const drops: number[] = [];
  const bar = 4;
  let last = -Infinity;
  for (let i = bar * 2; i < grid.length - bar * 2; i++) {
    if (i - last < bar * 8) continue;
    const before = mean(env, fps, grid[i - bar * 2], grid[i]);
    const after = mean(env, fps, grid[i], grid[i + bar * 2]);
    if (after - before < jump || after < 0.45) continue;
    // a batida com a maior subida nas próximas 4
    let best = i;
    let bestJump = after - before;
    for (let k = i + 1; k < Math.min(grid.length - bar * 2, i + 4); k++) {
      const j = mean(env, fps, grid[k], grid[k + bar * 2]) - mean(env, fps, grid[k - bar * 2], grid[k]);
      if (j > bestJump) {
        best = k;
        bestJump = j;
      }
    }
    drops.push(grid[best]);
    last = best;
    i = best;
  }
  return drops;
};

export const buildTimeline = (input: TimelineInput): Timeline => {
  const { duration, env, fps, clips, style } = input;
  if (!clips.length || duration <= 0) return { segments: [], drops: [] };
  const rand = rng(input.seed);
  const S = STYLE[style];
  const grid = beatGrid(input.beats, input.bpm, duration);
  const drops = findDrops(grid, env, fps);
  const dropSet = new Set(drops);
  const period = grid.length > 1 ? (grid[grid.length - 1] - grid[0]) / (grid.length - 1) : 0.5;

  // Os instantes de corte.
  const cuts: { t: number; drop: boolean; burst: boolean }[] = [];
  let i = 0;
  while (i < grid.length) {
    const t = grid[i];
    const drop = dropSet.has(t);
    if (drop && style !== "slow") {
      // rajada antes da drop: 4 cortes a meia batida
      for (let k = 4; k >= 1; k--) {
        const bt = t - (k * period) / 2;
        if (bt > (cuts[cuts.length - 1]?.t ?? -1) + 0.05) cuts.push({ t: bt, drop: false, burst: true });
      }
    }
    cuts.push({ t, drop, burst: false });
    const e = mean(env, fps, t, grid[Math.min(grid.length - 1, i + 4)] ?? t + period * 4);
    const level = e > 0.6 ? 2 : e > 0.38 ? 1 : 0;
    let step: number = S.beats[level];
    // depois de uma drop, fica rápido durante 2 compassos
    if (drops.some((d) => t >= d && t < d + period * 8)) step = Math.min(step, style === "slow" ? 2 : 1);
    if (level === 2 && step === 1 && rand() < S.half && i + 1 < grid.length) {
      cuts.push({ t: (t + grid[i + 1]) / 2, drop: false, burst: true });
    }
    // os cortes caem nos tempos fortes (múltiplos do passo)
    let next = i + step;
    if (step > 1) next -= next % step;
    // uma drop pelo meio corta lá, sempre
    for (let k = i + 1; k < next && k < grid.length; k++) {
      if (dropSet.has(grid[k])) {
        next = k;
        break;
      }
    }
    i = next;
  }
  cuts.sort((a, b) => a.t - b.t);

  // Um clipe por troço, sem repetir os últimos; nas drops um ainda não visto.
  const recent: number[] = [];
  const seen = new Set<number>();
  const pickClip = (fresh: boolean): number => {
    const n = clips.length;
    const avoid = new Set(recent.slice(-Math.min(3, n - 1)));
    const pool: number[] = [];
    for (let c = 0; c < n; c++) if (!avoid.has(c) && (!fresh || !seen.has(c))) pool.push(c);
    const list = pool.length ? pool : [...Array(n).keys()].filter((c) => !avoid.has(c));
    const c = (list.length ? list : [0])[Math.floor(rand() * (list.length || 1))];
    recent.push(c);
    seen.add(c);
    return c;
  };

  const segments: Segment[] = [];
  for (let k = 0; k < cuts.length; k++) {
    const { t, drop, burst } = cuts[k];
    const t1 = k + 1 < cuts.length ? cuts[k + 1].t : duration;
    if (t1 - t < 0.04) continue;
    const len = t1 - t;
    const clipIdx = pickClip(drop);
    const clip = clips[clipIdx];
    let r0 = S.speed[0] + rand() * (S.speed[1] - S.speed[0]);
    let r1 = r0;
    if (drop) {
      // rampa: devagar a acelerar
      r0 = 0.45;
      r1 = style === "chaos" ? 2.0 : 1.5;
    } else if (style === "slow") {
      r1 = Math.min(1, r0 + 0.2);
    } else if (style === "chaos" && rand() < 0.3) {
      r1 = 0.5 + rand() * 1.5;
    }
    const need = (len * (r0 + r1)) / 2;
    if (need > clip.duration - 0.05) {
      const k2 = Math.max(0.3, (clip.duration - 0.05) / need);
      r0 *= k2;
      r1 *= k2;
    }
    const used = (len * (r0 + r1)) / 2;
    const room = Math.max(0, clip.duration - used - 0.02);
    const sceneStarts = (clip.cuts ?? []).map((c) => c + 0.04).filter((c) => c <= room);
    const inAt = sceneStarts.length && rand() < 0.7 ? sceneStarts[Math.floor(rand() * sceneStarts.length)] : rand() * room;
    const e = mean(env, fps, t, t + 0.25);
    const downbeat = Math.round((t - grid[0]) / period) % 4 === 0;
    const fx: Fx = {
      flash: drop ? 1 : burst ? S.flash * 0.6 : S.flash * (0.4 + e) * (downbeat ? 1 : 0.5),
      zoom: drop ? Math.max(0.12, S.zoom * 2) : downbeat || burst ? S.zoom : S.zoom * 0.4,
      shake: drop ? Math.max(0.5, S.shake) : S.shake * e,
      rgb: drop ? Math.max(0.6, S.rgb) : burst ? S.rgb : S.rgb * e * 0.6,
      invert: style === "chaos" && (drop || (burst && rand() < 0.25)),
    };
    segments.push({ t0: t, t1, clip: clipIdx, inAt: Math.round(inAt * 1000) / 1000, r0, r1, fx, drop });
  }
  if (segments.length && segments[0].t0 > 0) segments[0].t0 = 0;
  return { segments, drops };
};

/** O troço em `t` (pesquisa binária), ou -1. */
export const segmentAt = (segments: Segment[], t: number): number => {
  let lo = 0;
  let hi = segments.length - 1;
  if (hi < 0 || t < segments[0].t0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Onde vai o clipe `s` segundos dentro do troço (com a rampa de velocidade). */
export const clipTime = (seg: Segment, s: number): number => {
  const len = Math.max(0.001, seg.t1 - seg.t0);
  return seg.inAt + seg.r0 * s + ((seg.r1 - seg.r0) * s * s) / (2 * len);
};

export const rateAt = (seg: Segment, s: number): number => {
  const len = Math.max(0.001, seg.t1 - seg.t0);
  return seg.r0 + ((seg.r1 - seg.r0) * Math.min(len, Math.max(0, s))) / len;
};
