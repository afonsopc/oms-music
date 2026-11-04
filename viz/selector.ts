/**
 * Que cena vem a seguir, com ~100 cenas.
 *
 * - Um baralho: nenhuma cena volta antes de quase todas as do conjunto terem
 *   passado (as favoritas podem passar duas vezes por volta; as banidas
 *   nunca). O que já passou fica guardado no aparelho (localStorage) durante
 *   12 h, por isso o baralho continua de música para música e entre aberturas.
 * - As últimas 6 nunca se repetem, mesmo ao virar o baralho.
 * - "style": só a família da música (pelos géneros, song.tags; sem eles,
 *   pelo andamento e pela energia). As etiquetas da cena que batem com as da
 *   música dão-lhe mais peso; a intensidade da cena aproxima-se da da secção.
 * - O nível do aparelho (1..3) tira as cenas mais caras.
 * - `peek` escolhe já a seguinte (para a carregar antes); `next` devolve-a.
 */
import type { SceneFamily, SceneName, SceneSelection, VizSong } from "./protocol";
import type { SceneMeta } from "./lib/scene";
import type { Decoded } from "./signal";

const CHAOS = /hardstyle|hyperpop|digicore|breakcore|glitch|metal|punk|hardcore|dubstep|drum ?(and|&|n) ?bass|dnb|gabber|phonk|nightcore|hardtek|frenchcore|jumpstyle|rawstyle|speedcore|noise/;
const CALM = /fado|acoustic|acústic|folk|jazz|classical|clássic|ambient|lo-?fi|piano|bossa|soul|singer-songwriter|chill|ballad|balada|orchestr|instrumental/;
const ELECTRONIC = /electro|house|techno|trance|synth|edm|disco|dance|future|eurobeat|idm|garage|club|electronic|eletr|electr/;

export const meanEnergy = (d: Decoded | null): number => {
  if (!d || d.env.length === 0) return 0.5;
  let s = 0;
  for (let i = 0; i < d.env.length; i++) s += d.env[i];
  return s / d.env.length / 255;
};

export const familyFor = (song: VizSong | null, d: Decoded | null): SceneFamily => {
  const tags = (song?.tags ?? []).join(" ").toLowerCase();
  if (CHAOS.test(tags)) return "chaos";
  if (CALM.test(tags)) return "calm";
  if (ELECTRONIC.test(tags)) return "electronic";
  const bpm = song?.bpm ?? d?.bpm ?? 120;
  const energy = meanEnergy(d);
  if ((bpm >= 150 && energy > 0.55) || energy > 0.78) return "chaos";
  if (bpm < 100 && energy < 0.6) return "calm";
  if (energy > 0.6) return "electronic";
  return "retro";
};

export interface PickContext {
  selection: SceneSelection;
  family: SceneFamily;
  favorites: SceneName[];
  banned: SceneName[];
  /** Nível do aparelho: só entram cenas com `cost` <= tier. */
  tier: 1 | 2 | 3;
  /** Géneros da música, em minúsculas e juntos ("fado guitarra"). */
  songTags?: string;
  /** Intensidade da secção que vai começar, 0..1. */
  intensity?: number;
}

interface Stored { at: number; seen: [SceneName, number][]; recent: SceneName[] }
export interface BagStore { get(): Stored | null; set(v: Stored): void }

const KEY = "oms-viz-bag";
const TTL = 12 * 3600 * 1000;
const RECENT = 6;

export const localBagStore = (): BagStore => ({
  get() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
      return v && Date.now() - v.at < TTL ? v : null;
    } catch {
      return null;
    }
  },
  set(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento: fica só em memória */ }
  },
});

export const memoryBagStore = (): BagStore => {
  let v: Stored | null = null;
  return { get: () => v, set: (x) => { v = x; } };
};

/** Um aleatório próprio (não o Math.random das cenas, para não mexer nas sequências delas). */
const ownRandom = () => {
  const seed = new Uint32Array(1);
  try { crypto.getRandomValues(seed); } catch { seed[0] = Date.now(); }
  let s = seed[0] >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export class ScenePicker {
  private seen = new Map<SceneName, number>();
  private recent: SceneName[] = [];
  private pending: { id: SceneName; key: string } | null = null;
  private metas: SceneMeta[];

  constructor(metas: SceneMeta[], private store: BagStore = memoryBagStore(), private random: () => number = ownRandom()) {
    this.metas = metas.filter((m) => !m.background);
    const s = store.get();
    if (s) {
      const ok = new Set(this.metas.map((m) => m.id));
      this.seen = new Map(s.seen.filter(([id]) => ok.has(id)));
      this.recent = s.recent.filter((id) => ok.has(id));
    }
  }

  /** O conjunto de onde se escolhe, com recuos se ficar vazio. */
  pool(ctx: PickContext): SceneMeta[] {
    const ban = new Set(ctx.banned);
    const fits = (m: SceneMeta) => !ban.has(m.id) && m.cost <= ctx.tier;
    let pool = this.metas.filter((m) => fits(m) && (ctx.selection === "random" || m.families.includes(ctx.family)));
    if (pool.length < 2) pool = this.metas.filter(fits);
    if (pool.length < 2) pool = this.metas.filter((m) => !ban.has(m.id));
    if (pool.length === 0) pool = this.metas;
    return pool;
  }

  private key(ctx: PickContext) {
    return `${ctx.selection}|${ctx.family}|${ctx.tier}|${ctx.favorites.join()}|${ctx.banned.join()}`;
  }

  private choose(ctx: PickContext): SceneName {
    const pool = this.pool(ctx);
    const fav = new Set(ctx.favorites);
    const allowed = (m: SceneMeta) => (this.seen.get(m.id) ?? 0) < (fav.has(m.id) ? 2 : 1);
    const keep = Math.min(RECENT, Math.floor(pool.length / 2));
    const recent = new Set(this.recent.slice(-keep));
    let cands = pool.filter((m) => allowed(m) && !recent.has(m.id));
    if (cands.length === 0) {
      // virar o baralho: o que é deste conjunto volta a poder sair
      for (const m of pool) this.seen.delete(m.id);
      cands = pool.filter((m) => !recent.has(m.id));
      if (cands.length === 0) cands = pool;
    }
    const tags = ctx.songTags ?? "";
    const weights = cands.map((m) => {
      let w = 1;
      if (tags && m.tags.some((t) => t.length > 2 && tags.includes(t))) w *= 2;
      if (ctx.intensity !== undefined) w *= 0.5 + (1 - Math.min(1, Math.abs(m.intensity / 5 - ctx.intensity) * 1.6));
      return Math.max(0.05, w);
    });
    let r = this.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i].id;
    }
    return cands[cands.length - 1].id;
  }

  /** A que vem a seguir, sem a gastar (para a carregar já). */
  peek(ctx: PickContext): SceneName {
    const key = this.key(ctx);
    if (this.pending && this.pending.key === key && this.pool(ctx).some((m) => m.id === this.pending!.id) && !this.recent.slice(-1).includes(this.pending.id)) return this.pending.id;
    const id = this.choose(ctx);
    this.pending = { id, key };
    return id;
  }

  next(ctx: PickContext): SceneName {
    const id = this.peek(ctx);
    this.pending = null;
    this.saw(id);
    return id;
  }

  /** Uma cena que passou (escolhida à mão, ou o refrão que volta) também conta. */
  saw(id: SceneName): void {
    this.seen.set(id, (this.seen.get(id) ?? 0) + 1);
    this.recent.push(id);
    if (this.recent.length > 24) this.recent.shift();
    if (this.pending?.id === id) this.pending = null;
    this.store.set({ at: Date.now(), seen: [...this.seen], recent: this.recent });
  }

  get last(): SceneName | null {
    return this.recent[this.recent.length - 1] ?? null;
  }
}
