/**
 * Ajudante do pacote geometria: um executor de shaders de ecrã inteiro como o
 * `shaderScene` de viz/lib, com uniformes a mais que um shader sozinho não
 * consegue ter (precisam de memória entre frames):
 *
 *   TF     tempo que corre mais depressa com a energia, os graves e as quedas
 *   TZ     tempo dos graves (só anda quando há graves: zooms, fluxos)
 *   KICK   envolvente da batida pesada pelos graves (ataque curto, ~0,3 s)
 *   BN BP  número da batida e a fase dentro dela (0..1)
 *   BARN   número do compasso
 *   SG     grupo da secção (o refrão que volta tem o mesmo), SIDX o índice
 *   SHIFT  1 -> 0 em ~1,2 s depois de cada mudança de secção
 *   PK     0..1, a deslizar para 1 nas secções fortes (queda, refrão, alta)
 *   BUILD  0..1 ao longo de uma subida (8 s), 0 fora dela
 *   LY     0..1 com uma linha de letra no ecrã (para dar espaço ao texto)
 *   Q      qualidade: 1 poupança/aparelho fraco, 2, 3
 *   SEED   0..1, um número por música (cada música vê a cena a seu modo)
 *
 * Com "reduzir movimento" o `t` pára, TF e TZ também (o frame parado começa
 * num instante bonito, não no zero). Cada cena pode juntar uniformes seus
 * (`extra`). Sem alocar no frame.
 */
import { cachedProgram, deleteTarget, prewarmProgram, sharedTriangle, target, uniforms, type Target } from "../../lib/gl";
import { GLSL_HEAD } from "../../lib/shader";
import type { FrameInfo, SceneEnv, SceneHost, SceneInstance, SceneMeta, SceneModule, Signal } from "../../lib/scene";

export const HEAD = GLSL_HEAD + `
uniform float TF, TZ, KICK, BN, BP, BARN, SG, SIDX, SHIFT, PK, BUILD, LY, Q, SEED;
#define PI 3.14159265
#define TAU 6.2831853
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
// a cor da capa mais viva (para néon) e uma versão escura (para fundos)
vec3 vivid(vec3 c){ float l = max(max(c.r,c.g),c.b); return l < .05 ? vec3(.8) : c/l; }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
`;

const BASE = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "PREV",
  "TF", "TZ", "KICK", "BN", "BP", "BARN", "SG", "SIDX", "SHIFT", "PK", "BUILD", "LY", "Q", "SEED"] as const;

/** O estado partilhado que o executor mantém (as cenas podem lê-lo no `extra.update`). */
export interface GeoState {
  tf: number; tz: number; kick: number; shift: number; pk: number; build: number; ly: number; seed: number;
  /** Mudou de secção neste frame (e se é grande). */
  sectionHit: boolean; sectionBig: boolean;
  /** Bateu neste frame (uma vez por batida) / compasso. */
  beatHit: boolean; barHit: boolean;
  dt: number;
}

export interface Extra<K extends string> {
  names: readonly K[];
  /** Chamado em cada frame, com o programa em uso: pôr aqui os uniformes da cena. */
  update(gl: WebGL2RenderingContext, u: Record<K, WebGLUniformLocation | null>, t: number, s: Signal, st: GeoState, env: SceneEnv): void;
  /** Música nova. */
  song?(env: SceneEnv, st: GeoState): void;
}

export interface GeoOptions<K extends string> {
  feedback?: boolean;
  feedbackScale?: number;
  extra?: Extra<K>;
  /** Velocidade de base do TF (0,4 por omissão). */
  flow?: number;
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
};

const ease = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

export const geoScene = <K extends string = never>(meta: Omit<SceneMeta, "layer">, frag: string, opts: GeoOptions<K> = {}): SceneModule => ({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { prewarmProgram(gl, frag); },
  create(): SceneInstance {
    let host: SceneHost | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let u: Record<(typeof BASE)[number], WebGLUniformLocation | null> | null = null;
    let ux: Record<K, WebGLUniformLocation | null> | null = null;
    let fb: [Target, Target] | null = null;
    let lastT = -1, lastBeat = -1, lastBar = -1, lastSec = -2;
    const st: GeoState = { tf: 0, tz: 0, kick: 0, shift: 0, pk: 0, build: 0, ly: 0, seed: 0, sectionHit: false, sectionBig: false, beatHit: false, barHit: false, dt: 0 };
    const flow = opts.flow ?? 0.4;

    const advance = (t: number, s: Signal, env: SceneEnv) => {
      const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      st.dt = dt;
      const bn = Math.floor(s.beatPos), barn = Math.floor(s.bar);
      st.beatHit = lastBeat >= 0 && bn !== lastBeat;
      st.barHit = lastBar >= 0 && barn !== lastBar;
      lastBeat = bn; lastBar = barn;
      st.sectionHit = lastSec !== -2 && s.sectionIndex !== lastSec;
      st.sectionBig = st.sectionHit && s.drop > 0.5;
      lastSec = s.sectionIndex;
      st.tf += dt * (flow + 0.9 * s.energy + 0.5 * s.bass + 1.6 * s.drop);
      st.tz += dt * (0.08 + s.bass * s.bass * 1.2 + 0.6 * s.beat * s.bass + 0.8 * s.drop);
      if (st.beatHit) st.kick = Math.max(st.kick, 0.45 + 0.55 * s.bass);
      st.kick *= Math.exp(-dt / 0.28);
      if (st.sectionHit) st.shift = 1;
      st.shift = Math.max(0, st.shift - dt / 1.2);
      const peak = s.section === "drop" || s.section === "chorus" || s.section === "high" ? 1 : 0;
      st.pk = ease(st.pk, Math.max(peak, s.drop), 2.5, dt);
      st.build = s.section === "build" ? Math.min(1, s.sectionAge / 8) : ease(st.build, 0, 4, dt);
      st.ly = ease(st.ly, env.lyric ? 1 : 0, 3, dt);
    };

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
      g.uniform1f(l.TF, st.tf);
      g.uniform1f(l.TZ, st.tz);
      g.uniform1f(l.KICK, st.kick);
      g.uniform1f(l.BN, Math.floor(s.beatPos));
      g.uniform1f(l.BP, s.beatPos - Math.floor(s.beatPos));
      g.uniform1f(l.BARN, Math.floor(s.bar));
      g.uniform1f(l.SG, Math.max(0, s.sectionGroup));
      g.uniform1f(l.SIDX, Math.max(0, s.sectionIndex));
      g.uniform1f(l.SHIFT, st.shift);
      g.uniform1f(l.PK, st.pk);
      g.uniform1f(l.BUILD, st.build);
      g.uniform1f(l.LY, st.ly);
      g.uniform1f(l.Q, env.lowPower ? 1 : env.tier);
      g.uniform1f(l.SEED, st.seed);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, env.coverTex);
      g.uniform1i(l.COVER, 0);
      if (opts.extra && ux) opts.extra.update(g, ux, t, s, st, env);
    };

    const song = () => {
      const env = host!.env;
      st.seed = hashStr(`${env.title}\u0000${env.artist}`);
      // o frame parado (reduzir movimento) e o primeiro: num instante com forma, não no zero
      st.tf = 12 + 40 * st.seed;
      st.tz = 3 + 5 * st.seed;
      opts.extra?.song?.(env, st);
    };

    return {
      init(h) {
        host = h;
        gl = h.gl;
        if (!gl) throw new Error("sem WebGL2");
        prog = cachedProgram(gl, frag);
        u = uniforms(gl, prog, BASE);
        if (opts.extra) ux = uniforms(gl, prog, opts.extra.names);
        song();
      },
      song,
      resize() {
        if (gl && fb) { deleteTarget(gl, fb[0]); deleteTarget(gl, fb[1]); }
        fb = null;
      },
      frame(t, s, f: FrameInfo) {
        if (!gl || !prog || !host) return;
        advance(t, s, host.env);
        const g = gl;
        if (opts.feedback && !fb) {
          const k = opts.feedbackScale ?? 0.6;
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
          g.drawArrays(g.TRIANGLES, 0, 3);
          g.bindFramebuffer(g.FRAMEBUFFER, null);
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
        g.activeTexture(g.TEXTURE0);
      },
      dispose() {
        if (gl && fb) { deleteTarget(gl, fb[0]); deleteTarget(gl, fb[1]); }
        fb = null;
        prog = null;
        host = null;
      },
    };
  },
});
