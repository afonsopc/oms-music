/**
 * Ajudantes do pacote física (simulações e brinquedos físicos).
 *
 * `gpuScene`: uma cena WebGL feita de passes. A fábrica recebe um `Gpu`, que
 * cria texturas de estado (em vaivém, `Pair`), programas de ecrã inteiro
 * (`full`, com cache) e programas com vértices próprios (`custom`, para
 * pontos e linhas lidos de uma textura de estado), e apaga tudo no fim.
 * Todos os programas têm os uniformes do GLSL_HEAD (R, T, B, BEAT, C1...)
 * mais os de `FIS_HEAD`: S0..S2 (texturas de entrada), SR (tamanho do alvo),
 * DT (passo fixo), STEP (contador de passos) e P[8] (vec4 que a cena enche
 * no JS: impulsos, posições, modos).
 *
 * `Stepper`: passo fixo com tecto (a simulação anda igual a 30 ou a 144 fps
 * e não se afoga se um frame demorar); com "reduzir movimento" corre de uma
 * vez os passos de aquecimento e depois fica parado, para o frame parado já
 * mostrar a simulação feita.
 */
import { GLSL_HEAD } from "../../lib/shader";
import { cachedProgram, prewarmProgram, sharedTriangle } from "../../lib/gl";
import { defineScene, type FrameInfo, type SceneEnv, type SceneHost, type SceneMeta, type SceneModule, type Signal } from "../../lib/scene";

/** Uniformes e utilitários comuns (fragment). */
export const FIS_HEAD = GLSL_HEAD + `
uniform sampler2D S0, S1, S2;
uniform vec2 SR;
uniform float DT, STEP;
uniform vec4 P[8];
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 vivid(vec3 c){ vec3 g=vec3(lum(c)); c=mix(g,c,1.4); float l=max(lum(c),.001); return clamp(c*max(1.,.45/l),0.,1.); }
vec2 hash22(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float hash11(float n){ return fract(sin(n*12.9898)*43758.5453); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
`;

/** O mesmo para os vertex shaders próprios (escrevem `uv` para o fragment poder usar o FIS_HEAD). */
export const VHEAD = `#version 300 es
precision highp float;
out vec2 uv;
uniform vec2 R, SR; uniform float T, E, B, LM, M, H, BEAT, BAR, ON, DROP, SEC, SECAGE, DT, STEP;
uniform vec3 C1, C2, C3; uniform sampler2D S0, S1, S2; uniform vec4 P[8];
float hash11(float n){ return fract(sin(n*12.9898)*43758.5453); }
vec3 pal(float t){ t=fract(t); return t<.33? mix(C1,C2,t*3.) : t<.66? mix(C2,C3,(t-.33)*3.) : mix(C3,C1,(t-.66)*3.); }
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 vivid(vec3 c){ vec3 g=vec3(lum(c)); c=mix(g,c,1.4); float l=max(lum(c),.001); return clamp(c*max(1.,.45/l),0.,1.); }
`;

const NAMES = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "S0", "S1", "S2", "SR", "DT", "STEP", "P"] as const;
type Loc = Record<(typeof NAMES)[number], WebGLUniformLocation | null>;

export interface Buf { w: number; h: number; tex: WebGLTexture; fb: WebGLFramebuffer }
export type Fmt = "f16" | "f32" | "u8";
export interface BufOpts { fmt?: Fmt; linear?: boolean; repeat?: boolean }

/** Duas texturas: lê-se de `read`, escreve-se em `write`, `swap()` troca. */
export class Pair {
  constructor(public a: Buf, public b: Buf) {}
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
}

export type Blend = "add" | "alpha" | "max" | null;

export class Gpu {
  readonly gl: WebGL2RenderingContext;
  readonly env: SceneEnv;
  /** O frame actual (o wrapper actualiza antes de chamar a cena). */
  s!: Signal;
  t = 0;
  dt = 0;
  w = 1;
  h = 1;
  /** Os 8 vec4 de `P[8]`, enchidos pela cena. */
  readonly P = new Float32Array(32);
  /** Há texturas de vírgula flutuante em que se possa desenhar. */
  readonly float: boolean;
  private bufs = new Set<Buf>();
  private progs: WebGLProgram[] = [];
  private texs: WebGLTexture[] = [];
  private locs = new Map<WebGLProgram, Loc>();
  private vao: WebGLVertexArrayObject;
  private prog: WebGLProgram | null = null;
  private stepN = 0;

  constructor(host: SceneHost) {
    if (!host.gl) throw new Error("sem WebGL2");
    this.gl = host.gl;
    this.env = host.env;
    this.float = !!this.gl.getExtension("EXT_color_buffer_float");
    this.gl.getExtension("OES_texture_float_linear");
    this.vao = this.gl.createVertexArray()!;
  }

  buf(w: number, h: number, o: BufOpts = {}): Buf {
    const g = this.gl;
    const fmt = this.float ? (o.fmt ?? "f16") : "u8";
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    const filt = o.linear && fmt !== "f32" ? g.LINEAR : g.NEAREST;
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filt);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filt);
    const wrap = o.repeat ? g.REPEAT : g.CLAMP_TO_EDGE;
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, wrap);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, wrap);
    if (fmt === "f32") g.texImage2D(g.TEXTURE_2D, 0, g.RGBA32F, w, h, 0, g.RGBA, g.FLOAT, null);
    else if (fmt === "f16") g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, w, h, 0, g.RGBA, g.HALF_FLOAT, null);
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    const fb = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    const b = { w, h, tex, fb };
    this.bufs.add(b);
    return b;
  }

  pair(w: number, h: number, o: BufOpts = {}) { return new Pair(this.buf(w, h, o), this.buf(w, h, o)); }

  free(b: Buf | Pair | null) {
    if (!b) return;
    if (b instanceof Pair) { this.free(b.a); this.free(b.b); return; }
    if (!this.bufs.has(b)) return;
    this.bufs.delete(b);
    this.gl.deleteFramebuffer(b.fb);
    this.gl.deleteTexture(b.tex);
  }

  /** Uma textura de imagem (capa desenhada à mão, texto), apagada no fim. `upload` enche-a. */
  texture(): WebGLTexture {
    const g = this.gl, t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
    this.texs.push(t);
    return t;
  }
  upload(t: WebGLTexture, src: TexImageSource) {
    const g = this.gl;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  }

  /** Programa de ecrã inteiro (com cache partilhada: não se apaga). */
  full(frag: string) { return cachedProgram(this.gl, frag); }

  /** Programa com vértices próprios (pontos, linhas, triângulos sem atributos: `gl_VertexID`). */
  custom(vert: string, frag: string) {
    const g = this.gl;
    const mk = (type: number, src: string) => {
      const sh = g.createShader(type)!;
      g.shaderSource(sh, src);
      g.compileShader(sh);
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const p = g.createProgram()!;
    const vs = mk(g.VERTEX_SHADER, vert), fs = mk(g.FRAGMENT_SHADER, frag);
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? "link");
    this.progs.push(p);
    return p;
  }

  clear(b: Buf | null, r = 0, gg = 0, bb = 0, a = 1) {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, b ? b.fb : null);
    g.viewport(0, 0, b ? b.w : this.w, b ? b.h : this.h);
    g.clearColor(r, gg, bb, a);
    g.clear(g.COLOR_BUFFER_BIT);
  }

  private use(prog: WebGLProgram, out: Buf | null, s0: Buf | WebGLTexture | null, s1: Buf | WebGLTexture | null, s2: Buf | WebGLTexture | null) {
    const g = this.gl;
    let l = this.locs.get(prog);
    if (!l) {
      l = {} as Loc;
      for (const n of NAMES) l[n] = g.getUniformLocation(prog, n);
      this.locs.set(prog, l);
    }
    if (this.prog !== prog) { g.useProgram(prog); this.prog = prog; }
    g.bindFramebuffer(g.FRAMEBUFFER, out ? out.fb : null);
    const w = out ? out.w : this.w, h = out ? out.h : this.h;
    g.viewport(0, 0, w, h);
    const s = this.s, env = this.env;
    g.uniform2f(l.R, this.w, this.h);
    g.uniform2f(l.SR, w, h);
    g.uniform1f(l.T, this.t);
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
    g.uniform1f(l.DT, this.dt);
    g.uniform1f(l.STEP, this.stepN);
    g.uniform3fv(l.C1, env.colorVecs[0]);
    g.uniform3fv(l.C2, env.colorVecs[1]);
    g.uniform3fv(l.C3, env.colorVecs[2]);
    g.uniform4fv(l.P, this.P);
    const bind = (unit: number, loc: WebGLUniformLocation | null, x: Buf | WebGLTexture | null) => {
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, x && "tex" in (x as Buf) ? (x as Buf).tex : (x as WebGLTexture | null));
      g.uniform1i(loc, unit);
    };
    bind(0, l.COVER, env.coverTex);
    bind(1, l.S0, s0);
    bind(2, l.S1, s1);
    bind(3, l.S2, s2);
  }

  private blend(b: Blend) {
    const g = this.gl;
    if (!b) { g.disable(g.BLEND); return; }
    g.enable(g.BLEND);
    g.blendEquation(b === "max" ? g.MAX : g.FUNC_ADD);
    if (b === "add") g.blendFunc(g.ONE, g.ONE);
    else if (b === "alpha") g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
  }

  /** Um passe de ecrã inteiro para `out` (null: o ecrã). */
  pass(prog: WebGLProgram, out: Buf | null, s0: Buf | WebGLTexture | null = null, s1: Buf | WebGLTexture | null = null, s2: Buf | WebGLTexture | null = null, blend: Blend = null) {
    const g = this.gl;
    this.use(prog, out, s0, s1, s2);
    this.blend(blend);
    g.bindVertexArray(sharedTriangle(g));
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  /** Desenhar `count` vértices sem atributos (o vertex shader usa `gl_VertexID`). */
  draw(prog: WebGLProgram, out: Buf | null, mode: number, count: number, s0: Buf | WebGLTexture | null = null, s1: Buf | WebGLTexture | null = null, blend: Blend = "add") {
    const g = this.gl;
    this.use(prog, out, s0, s1, null);
    this.blend(blend);
    g.bindVertexArray(this.vao);
    g.drawArrays(mode, 0, count);
  }

  /** Conta um passo de simulação (o `STEP` dos shaders). */
  tick() { this.stepN++; }

  /** Repor o estado partilhado como o motor o deixou. */
  restore() {
    const g = this.gl;
    g.disable(g.BLEND);
    g.blendEquation(g.FUNC_ADD);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, this.w, this.h);
    g.bindVertexArray(null);
    g.activeTexture(g.TEXTURE0);
    g.useProgram(null);
    this.prog = null;
  }

  dispose() {
    for (const b of this.bufs) { this.gl.deleteFramebuffer(b.fb); this.gl.deleteTexture(b.tex); }
    this.bufs.clear();
    for (const p of this.progs) this.gl.deleteProgram(p);
    this.progs.length = 0;
    for (const t of this.texs) this.gl.deleteTexture(t);
    this.texs.length = 0;
    this.gl.deleteVertexArray(this.vao);
    this.restore();
  }
}

export interface GpuSim {
  /** O ecrã mudou de tamanho (também logo a seguir ao início). */
  resize?(w: number, h: number): void;
  frame(g: Gpu, f: FrameInfo): void;
  /** Música nova: recomeçar a simulação com graça. */
  song?(): void;
}

/** Uma cena WebGL de vários passes. `prewarm`: os fragment shaders de ecrã inteiro a compilar antes de entrar. */
export const gpuScene = (meta: Omit<SceneMeta, "layer">, prewarm: string[], factory: (g: Gpu) => GpuSim): SceneModule => defineScene({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { for (const f of prewarm) prewarmProgram(gl, f); },
  create() {
    let g: Gpu | null = null;
    let sim: GpuSim | null = null;
    let size = "";
    return {
      init(host) { g = new Gpu(host); sim = factory(g); },
      resize() { size = ""; },
      frame(t, s, f) {
        if (!g || !sim) return;
        g.s = s;
        g.t = t;
        g.w = f.w;
        g.h = f.h;
        const k = `${f.w}x${f.h}`;
        if (k !== size) { size = k; sim.resize?.(f.w, f.h); }
        try { sim.frame(g, f); } finally { g.restore(); }
      },
      song() { sim?.song?.(); },
      dispose() { g?.dispose(); g = null; sim = null; },
    };
  },
});

/**
 * Passo fixo com tecto. `n(dt, env)` diz quantos passos dar neste frame.
 * Com "reduzir movimento" dá `warm` passos uma vez (para a imagem parada já
 * ter a simulação feita) e depois nenhum; `reset()` volta a aquecer.
 */
export class Stepper {
  private acc = 0;
  private warmed = false;
  constructor(public hz = 60, public max = 3, public warm = 120) {}
  n(dt: number, env: SceneEnv): number {
    if (env.reduceMotion) {
      if (this.warmed) return 0;
      this.warmed = true;
      return this.warm;
    }
    this.warmed = false;
    this.acc += Math.min(dt, 0.1);
    let n = Math.floor(this.acc * this.hz + 1e-6);
    this.acc -= n / this.hz;
    if (n > this.max) { n = this.max; this.acc = 0; }
    return n;
  }
  reset() { this.acc = 0; this.warmed = false; }
}

/** As cores da capa em strings CSS para o Canvas 2D, refeitas de vez em quando (não por elemento nem por frame). */
export class CssPal {
  readonly c: string[];
  readonly v: Float32Array;
  private n = 0;
  constructor(public size = 12, public alpha = 1) {
    this.c = new Array<string>(size).fill("#fff");
    this.v = new Float32Array(size * 3);
  }
  /** `vivid`: puxar as capas escuras para cores com luz. */
  update(env: SceneEnv, vivid = true, every = 8) {
    if (this.n++ % every !== 0) return;
    const cv = env.colorVecs;
    for (let i = 0; i < this.size; i++) {
      let t = i / this.size;
      const seg = Math.min(2, Math.floor(t * 3));
      t = t * 3 - seg;
      const a = cv[seg], b = cv[(seg + 1) % 3];
      let r = a[0] + (b[0] - a[0]) * t, gg = a[1] + (b[1] - a[1]) * t, bb = a[2] + (b[2] - a[2]) * t;
      if (vivid) {
        const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
        r = l + (r - l) * 1.4; gg = l + (gg - l) * 1.4; bb = l + (bb - l) * 1.4;
        const k = Math.max(1, 0.5 / Math.max(0.001, l));
        r = Math.min(1, Math.max(0, r * k)); gg = Math.min(1, Math.max(0, gg * k)); bb = Math.min(1, Math.max(0, bb * k));
      }
      this.v[i * 3] = r; this.v[i * 3 + 1] = gg; this.v[i * 3 + 2] = bb;
      this.c[i] = `rgba(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(bb * 255)},${this.alpha})`;
    }
  }
  at(t: number) { const i = Math.floor((t - Math.floor(t)) * this.size); return this.c[Math.min(this.size - 1, i)]; }
}

/** Passo fixo simples para o processador (Canvas 2D): devolve quantos passos e guarda o resto. */
export const steps = (st: { acc: number }, dt: number, hz: number, max: number) => {
  st.acc += Math.min(dt, 0.1);
  let n = Math.floor(st.acc * hz + 1e-6);
  st.acc -= n / hz;
  if (n > max) { n = max; st.acc = 0; }
  return n;
};

/**
 * Bolas com brilho, uma por cor da `CssPal` (para o Canvas 2D: `drawImage` de
 * um sprite é muito mais barato que gradientes por bola). Refazer de vez em
 * quando, não por frame; reutiliza os canvases de `out`.
 */
export const ballSprites = (pal: CssPal, out: HTMLCanvasElement[], size = 64) => {
  for (let i = 0; i < pal.size; i++) {
    const c = out[i] ?? document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d")!;
    x.clearRect(0, 0, size, size);
    const r = Math.round(pal.v[i * 3] * 255), g = Math.round(pal.v[i * 3 + 1] * 255), b = Math.round(pal.v[i * 3 + 2] * 255);
    const h = size / 2;
    const gr = x.createRadialGradient(h * 0.8, h * 0.8, size / 32, h, h, h);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.25, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.5, `rgba(${r >> 1},${g >> 1},${b >> 1},0.95)`);
    gr.addColorStop(0.55, `rgba(${r},${g},${b},0.25)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, size, size);
    out[i] = c;
  }
};
