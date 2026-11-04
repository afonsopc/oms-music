/**
 * Ajudantes do pacote tipografia (só destas cenas).
 *
 * - `Lyric`: a linha que está a tocar (`env.lyric`) partida em palavras, com
 *   a hora a que cada palavra acende: a do alinhamento de cada palavra
 *   (`env.lyricWords`, a mesma da letra e da camada de letra do motor) e só
 *   sem ela estimada pelo tamanho das palavras. Sem letra, alterna o título
 *   e o artista de dois em dois compassos; entre duas linhas segura a
 *   anterior uns segundos.
 * - `units`: o texto em pedaços para desenhar letra a letra sem estragar as
 *   escritas que ligam as letras (árabe, devanágari...: aí vai palavra a
 *   palavra) e na ordem visual certa nas da direita para a esquerda.
 * - `textShader`: um shader de ecrã inteiro com uma textura de texto (TXT),
 *   desenhada num Canvas 2D só quando o texto muda.
 */
import { GLSL_HEAD } from "../../lib/shader";
import { cachedProgram, deleteTarget, prewarmProgram, sharedTriangle, target, uniforms, type Target } from "../../lib/gl";
import { WORD_LEAD_S, type SceneEnv, type SceneHost, type SceneInstance, type SceneMeta, type SceneModule, type Signal } from "../../lib/scene";
import { WIDE, uploadTexture } from "../../lib/text";

export { WIDE };
export const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const SERIF = "Georgia, 'Times New Roman', serif";
export const MONO = "ui-monospace, Menlo, 'Courier New', monospace";
export const TYPE = "'Courier New', Courier, ui-monospace, monospace";

/** Escritas da direita para a esquerda (hebraico, árabe...). */
export const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** Escritas em que as letras soltas perdem a forma: desenha-se palavra a palavra. */
export const JOIN_RE = /[؀-ۿݐ-ݿࢠ-ࣿऀ-෿฀-๿ༀ-࿿က-႟ក-៿ﭐ-﷿ﹰ-﻿]/;
/** Escritas sem maiúsculas nem espaços largos (CJK): letras grandes servem bem. */
export const CJK_RE = /[぀-ヿ㐀-鿿가-힯]/;

let seg: { segment(s: string): Iterable<{ segment: string }> } | null | undefined;
const graphemes = (s: string): string[] => {
  if (seg === undefined) {
    const I = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
    seg = I ? new I(undefined, { granularity: "grapheme" }) : null;
  }
  if (!seg) return Array.from(s);
  const out: string[] = [];
  for (const g of seg.segment(s)) out.push(g.segment);
  return out;
};

/**
 * O texto em pedaços na ordem em que se desenham da esquerda para a direita:
 * letras (com espaços " ") nas escritas normais; palavras nas que ligam as
 * letras; invertido nas da direita para a esquerda. Só quando o texto muda.
 */
export const units = (text: string): string[] => {
  const rtl = RTL_RE.test(text);
  let u: string[];
  if (JOIN_RE.test(text)) {
    u = [];
    const ws = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < ws.length; i++) { if (i) u.push(" "); u.push(ws[i]); }
  } else u = graphemes(text);
  return rtl ? u.reverse() : u;
};

/** As palavras na ordem visual (invertidas nas escritas da direita para a esquerda). */
export const visualWords = (text: string): string[] => {
  const ws = text.split(/\s+/).filter(Boolean);
  return RTL_RE.test(text) ? ws.reverse() : ws;
};

/** Maiúsculas só onde fazem sentido (no hebraico e afins não mudam nada). */
export const upper = (s: string) => s.toLocaleUpperCase("pt-PT");

/** O título a mostrar (nunca vazio). */
export const titleOf = (env: SceneEnv) => (env.title || "").trim() || "OMS Music";
export const artistOf = (env: SceneEnv) => (env.artist || "").trim() || "OMS";

/** Pseudo-aleatório repetível por número (sem estado). */
export const hash1 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** O tamanho de letra com que `text` cabe em `maxW` (fonte = `font(px)`). */
export const fit = (ctx: CanvasRenderingContext2D, text: string, maxW: number, font: (px: number) => string, max: number, min = 6) => {
  ctx.font = font(100);
  const w = ctx.measureText(text).width || 1;
  return Math.max(min, Math.min(max, Math.floor((100 * maxW) / w)));
};

/** Partir em linhas (palavras demasiado longas partem-se a meio). */
export const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines = 99): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    while (ctx.measureText(w).width > maxW && w.length > 2) {
      let k = w.length - 1;
      while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, k));
      w = w.slice(k);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += "…"; }
  return lines;
};

/** Contador que sobe quando acabam de carregar fontes (OMSWide chega depois da primeira imagem). */
let fontGen = 0, fontHooked = false;
export const fontGeneration = () => {
  if (!fontHooked && typeof document !== "undefined" && document.fonts) {
    fontHooked = true;
    document.fonts.addEventListener("loadingdone", () => { fontGen++; });
    document.fonts.ready.then(() => { fontGen++; }).catch(() => {});
  }
  return fontGen;
};

const MAXW = 48;

/**
 * A linha da letra (ou o título/artista quando não há), as palavras e a
 * hora estimada de cada uma. Uma instância por cena; `update` uma vez por frame.
 */
export class Lyric {
  /** O texto mostrado agora. */
  text = "";
  /** As palavras (na ordem de leitura) e as horas (t do motor) a que acendem. */
  words: string[] = [];
  starts = new Float32Array(MAXW);
  ends = new Float32Array(MAXW);
  n = 0;
  /** Hora (t) a que a linha entrou. */
  t0 = 0;
  /** Linhas vistas até agora (sobe a cada mudança). */
  serial = 0;
  /** É letra a sério (falso: título/artista). */
  real = false;
  /** 0 título, 1 artista quando `real` é falso. */
  which = 0;
  rtl = false;
  /** Linhas anteriores (as mais recentes primeiro). */
  hist: string[] = [];
  private lastLyricAt = -99;
  private seenLyric = false;
  private hold = 5;

  constructor(private keep = 12) {}

  /** Verdadeiro quando a linha mudou neste frame. */
  update(env: SceneEnv, t: number, s: Signal): boolean {
    const l = env.lyric;
    let next = this.text, real = this.real, which = this.which;
    if (l && l.trim()) {
      this.lastLyricAt = t;
      this.seenLyric = true;
      next = l; real = true;
    } else if (!this.seenLyric || t - this.lastLyricAt > this.hold || t < this.lastLyricAt) {
      which = Math.floor(Math.max(0, s.bar) / 2) % 2;
      next = which === 0 ? titleOf(env) : artistOf(env);
      real = false;
    }
    const changed = !(next === this.text && real === this.real);
    if (changed) this.set(next, t, real, which);
    if (real && l && l.trim()) this.timed(env, t);
    return changed;
  }

  /**
   * Os tempos reais das palavras, passados para o relógio da cena (`t`): a
   * cada frame, para seguir um salto ou outra velocidade. Só quando as
   * palavras batem com o texto partido (as mesmas, pela mesma ordem).
   */
  private timed(env: SceneEnv, t: number) {
    const ws = env.lyricWords;
    if (!ws || (ws.length !== this.n && !(this.n === MAXW && ws.length > MAXW))) return;
    const shift = t - env.lyricTime - WORD_LEAD_S;
    for (let i = 0; i < this.n; i++) {
      this.starts[i] = ws[i][0] + shift;
      this.ends[i] = Math.max(ws[i][1], ws[i][0] + 0.05) + shift;
    }
  }

  /** Forçar uma linha (o título ao entrar, por exemplo). */
  set(text: string, t: number, real: boolean, which = 0) {
    if (this.text && this.real) { this.hist.unshift(this.text); if (this.hist.length > this.keep) this.hist.length = this.keep; }
    this.text = text;
    this.real = real;
    this.which = which;
    this.t0 = t;
    this.serial++;
    this.rtl = RTL_RE.test(text);
    this.words = text.split(/\s+/).filter(Boolean).slice(0, MAXW);
    this.n = this.words.length;
    let total = 0;
    for (let i = 0; i < this.n; i++) total += Math.min(0.7, Math.max(0.2, 0.12 + 0.055 * this.words[i].length));
    const k = total > 2.8 ? 2.8 / total : 1;
    let at = t;
    for (let i = 0; i < this.n; i++) {
      const d = Math.min(0.7, Math.max(0.2, 0.12 + 0.055 * this.words[i].length)) * k;
      this.starts[i] = at; this.ends[i] = at + d;
      at += d;
    }
  }

  /** Quantas palavras já acenderam (todas com "reduzir movimento"). */
  shown(t: number, env?: SceneEnv) {
    if (env?.reduceMotion) return this.n;
    let k = 0;
    while (k < this.n && this.starts[k] <= t) k++;
    return k;
  }

  /** Segundos desde que a palavra `i` acendeu (negativo: ainda não). */
  age(i: number, t: number) { return t - this.starts[i]; }
}

// ------------------------------------------------------------ shader com texto

const NAMES = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "PREV", "TXT", "TR", "U0", "U1", "U2", "U3"] as const;

/** O cabeçalho dos shaders de texto: o GLSL_HEAD mais TXT (a textura do texto), TR (o tamanho dela) e U0..U3 (livres). */
export const TEXT_HEAD = GLSL_HEAD + `uniform sampler2D TXT; uniform vec2 TR; uniform vec4 U0, U1, U2, U3;
`;

export interface TextShaderOpts {
  /** Tamanho do canvas do texto, a partir do tamanho do ecrã (píxeis). */
  size(w: number, h: number): [number, number];
  /** Desenhar o texto (fundo transparente ou o que a cena quiser). Chamado quando `dirty` diz, a fonte chega ou o tamanho muda. */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number, env: SceneEnv, lyr: Lyric, s: Signal): void;
  /** Redesenhar já? Por omissão: quando a linha muda. */
  dirty?(env: SceneEnv, lyr: Lyric, changed: boolean, t: number, s: Signal): boolean;
  /** Pôr os uniformes livres (16 números: U0..U3) por frame. */
  set?(u: Float32Array, t: number, s: Signal, env: SceneEnv, lyr: Lyric, dt: number, w: number, h: number): void;
  feedback?: boolean;
  feedbackScale?: number;
}

export const textShader = (meta: Omit<SceneMeta, "layer">, frag: string, o: TextShaderOpts): SceneModule => ({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { prewarmProgram(gl, frag); },
  create(): SceneInstance {
    let host: SceneHost | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let u: Record<(typeof NAMES)[number], WebGLUniformLocation | null> | null = null;
    let tex: WebGLTexture | null = null;
    let fb: [Target, Target] | null = null;
    // O canvas só nasce no init: o create corre sem browser (testes, prewarm).
    let cv: HTMLCanvasElement = null!;
    let cx: CanvasRenderingContext2D = null!;
    const lyr = new Lyric();
    const free = new Float32Array(16);
    let fg = -1, cw = 0, ch = 0, lastW = 0, lastH = 0, title = "", lastT = 0;
    const set = (w: number, h: number, t: number, s: Signal) => {
      const g = gl!, l = u!, env = host!.env;
      g.uniform2f(l.R, w, h);
      g.uniform1f(l.T, t);
      g.uniform1f(l.E, s.energy);
      g.uniform1f(l.B, s.bass);
      g.uniform1f(l.LM, s.lowmid);
      g.uniform1f(l.M, s.mid);
      g.uniform1f(l.H, s.high);
      g.uniform1f(l.BEAT, s.beat);
      g.uniform1f(l.BAR, s.bar);
      g.uniform1f(l.ON, s.onset);
      g.uniform1f(l.DROP, s.drop);
      g.uniform1f(l.SEC, s.sectionIntensity);
      g.uniform1f(l.SECAGE, s.sectionAge);
      g.uniform1f(l.PIX, env.fx.pixel ? 6 : 0);
      g.uniform1f(l.DITHER, env.fx.dither ? 1 : 0);
      g.uniform3fv(l.C1, env.colorVecs[0]);
      g.uniform3fv(l.C2, env.colorVecs[1]);
      g.uniform3fv(l.C3, env.colorVecs[2]);
      g.uniform2f(l.TR, cw, ch);
      g.uniform4f(l.U0, free[0], free[1], free[2], free[3]);
      g.uniform4f(l.U1, free[4], free[5], free[6], free[7]);
      g.uniform4f(l.U2, free[8], free[9], free[10], free[11]);
      g.uniform4f(l.U3, free[12], free[13], free[14], free[15]);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, env.coverTex);
      g.uniform1i(l.COVER, 0);
      g.activeTexture(g.TEXTURE2);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.uniform1i(l.TXT, 2);
      g.activeTexture(g.TEXTURE0);
    };
    return {
      init(h) {
        host = h;
        gl = h.gl;
        if (!gl) throw new Error("sem WebGL2");
        if (!cv) { cv = document.createElement("canvas"); cx = cv.getContext("2d")!; }
        prog = cachedProgram(gl, frag);
        u = uniforms(gl, prog, NAMES);
      },
      resize() {
        if (gl && fb) { deleteTarget(gl, fb[0]); deleteTarget(gl, fb[1]); }
        fb = null;
      },
      frame(t, s, f) {
        if (!gl || !prog || !host) return;
        const g = gl, env = host.env;
        const changed = lyr.update(env, t, s);
        const gen = fontGeneration();
        const dt = Math.min(0.1, Math.max(0, t - lastT));
        lastT = t;
        let need = !tex || gen !== fg || f.w !== lastW || f.h !== lastH || title !== env.title;
        if (!need) need = o.dirty ? o.dirty(env, lyr, changed, t, s) : changed;
        if (need) {
          fg = gen; lastW = f.w; lastH = f.h; title = env.title;
          const [a, b] = o.size(f.w, f.h);
          if (cv.width !== a || cv.height !== b) { cv.width = a; cv.height = b; }
          cw = a; ch = b;
          cx.setTransform(1, 0, 0, 1, 0, 0);
          cx.globalAlpha = 1;
          cx.globalCompositeOperation = "source-over";
          cx.clearRect(0, 0, a, b);
          o.paint(cx, a, b, env, lyr, s);
          tex = uploadTexture(g, cv, tex);
        }
        o.set?.(free, t, s, env, lyr, dt, f.w, f.h);
        if (o.feedback && !fb) {
          const k = o.feedbackScale ?? 0.6;
          const fw = Math.max(1, Math.round(f.w * k)), fh = Math.max(1, Math.round(f.h * k));
          fb = [target(g, fw, fh), target(g, fw, fh)];
        }
        g.useProgram(prog);
        g.bindVertexArray(sharedTriangle(g));
        if (fb) {
          const [a, b] = fb;
          g.bindFramebuffer(g.FRAMEBUFFER, b.fb);
          g.viewport(0, 0, b.w, b.h);
          set(b.w, b.h, t, s);
          g.activeTexture(g.TEXTURE1);
          g.bindTexture(g.TEXTURE_2D, a.tex);
          g.uniform1i(u!.PREV, 1);
          g.activeTexture(g.TEXTURE0);
          g.drawArrays(g.TRIANGLES, 0, 3);
          g.bindFramebuffer(g.READ_FRAMEBUFFER, b.fb);
          g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
          g.blitFramebuffer(0, 0, b.w, b.h, 0, 0, f.w, f.h, g.COLOR_BUFFER_BIT, g.LINEAR);
          g.bindFramebuffer(g.FRAMEBUFFER, null);
          fb = [b, a];
        } else {
          g.bindFramebuffer(g.FRAMEBUFFER, null);
          g.viewport(0, 0, f.w, f.h);
          set(f.w, f.h, t, s);
          g.drawArrays(g.TRIANGLES, 0, 3);
        }
      },
      dispose() {
        if (gl && fb) { deleteTarget(gl, fb[0]); deleteTarget(gl, fb[1]); }
        if (gl && tex) gl.deleteTexture(tex);
        fb = null; tex = null; prog = null; host = null;
      },
    };
  },
});
