/**
 * Ajudantes do pacote natureza.
 *
 * `natShader`: como o `shaderScene`, mais
 *   - `uniform vec4 U[8]` que a cena enche no JS a cada frame (estado que o
 *     shader não sabe guardar: relâmpagos, gotas, estação, rajadas...);
 *   - `scale`: desenhar a uma fracção da resolução e esticar (raymarching);
 *   - `feedback`: o frame anterior em PREV (como no shaderScene).
 * `NAT_GLSL`: GLSL_HEAD + ruído de valor 3D, voronoi, céu e uma paleta
 * "natural" que puxa as cores da capa para tons de natureza sem as perder.
 */
import { cachedProgram, deleteTarget, prewarmProgram, sharedTriangle, target, uniforms, type Target } from "../../lib/gl";
import { GLSL_HEAD } from "../../lib/shader";
import type { FrameInfo, SceneEnv, SceneHost, SceneInstance, SceneMeta, SceneModule, Signal } from "../../lib/scene";

export const NAT_GLSL = GLSL_HEAD + `
uniform vec4 U[8];
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 sat(vec3 c, float k){ return mix(vec3(lum(c)), c, k); }
/* a cor da capa mais viva e com luz mínima: as capas escuras também brilham */
vec3 vivid(vec3 c){ c = sat(c, 1.35); float l = max(lum(c), .001); return c * max(1., .42/l); }
float hash1(float n){ return fract(sin(n)*43758.5453123); }
vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  float n = i.x + i.y*157. + 113.*i.z;
  return mix(mix(mix(hash1(n),hash1(n+1.),f.x), mix(hash1(n+157.),hash1(n+158.),f.x),f.y),
             mix(mix(hash1(n+113.),hash1(n+114.),f.x), mix(hash1(n+270.),hash1(n+271.),f.x),f.y), f.z); }
float fbm3(vec3 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5;} return v; }
/* voronoi: x = distância à célula mais próxima, y = à fronteira, zw = id */
vec4 voro(vec2 p){
  vec2 n = floor(p), f = fract(p), mg = vec2(0), mr = vec2(0); float md = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j), r=g+hash2(n+g)-f; float d=dot(r,r); if(d<md){ md=d; mr=r; mg=g; } }
  float mb = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=mg+vec2(i,j), r=g+hash2(n+g)-f; if(dot(mr-r,mr-r)>1e-5) mb=min(mb, dot(.5*(mr+r), normalize(r-mr))); }
  return vec4(sqrt(md), mb, n+mg);
}
float sd_seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
`;

/** Escreve o estado da cena em `u` (8 vec4 = 32 números). `dt` é 0 com "reduzir movimento". */
export type NatUpdate = (u: Float32Array, t: number, s: Signal, dt: number, env: SceneEnv, w: number, h: number) => void;

export interface NatOptions {
  /** Fábrica do estado (uma por instância). */
  state?: () => NatUpdate;
  /** Resolução relativa (1 = a do motor). */
  scale?: number;
  /** Ler o frame anterior (PREV). */
  feedback?: boolean;
}

const NAMES = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "PREV", "U"] as const;

export const natShader = (meta: Omit<SceneMeta, "layer">, frag: string, opts: NatOptions = {}): SceneModule => ({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { prewarmProgram(gl, frag); },
  create(): SceneInstance {
    let host: SceneHost | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let u: Record<(typeof NAMES)[number], WebGLUniformLocation | null> | null = null;
    let fb: [Target, Target] | null = null;
    const data = new Float32Array(32);
    const update = opts.state?.();
    const scale = opts.scale ?? (opts.feedback ? 0.6 : 1);
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
      g.uniform1f(l.PIX, env.fx.pixel ? 6 * scale : 0);
      g.uniform1f(l.DITHER, env.fx.dither ? 1 : 0);
      g.uniform3fv(l.C1, env.colorVecs[0]);
      g.uniform3fv(l.C2, env.colorVecs[1]);
      g.uniform3fv(l.C3, env.colorVecs[2]);
      g.uniform4fv(l.U, data);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, env.coverTex);
      g.uniform1i(l.COVER, 0);
    };
    return {
      init(h) {
        host = h;
        gl = h.gl;
        if (!gl) throw new Error("sem WebGL2");
        prog = cachedProgram(gl, frag);
        u = uniforms(gl, prog, NAMES);
      },
      resize() {
        if (gl && fb) { deleteTarget(gl, fb[0]); deleteTarget(gl, fb[1]); }
        fb = null;
      },
      frame(t, s, f: FrameInfo) {
        if (!gl || !prog || !host) return;
        const g = gl;
        const env = host.env;
        if (update) update(data, t, s, env.reduceMotion ? 0 : f.dt, env, f.w, f.h);
        const off = opts.feedback || scale < 0.999;
        if (off && !fb) {
          const fw = Math.max(1, Math.round(f.w * scale)), fh = Math.max(1, Math.round(f.h * scale));
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
          g.bindFramebuffer(g.READ_FRAMEBUFFER, b.fb);
          g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
          g.blitFramebuffer(0, 0, b.w, b.h, 0, 0, f.w, f.h, g.COLOR_BUFFER_BIT, g.LINEAR);
          g.bindFramebuffer(g.FRAMEBUFFER, null);
          g.activeTexture(g.TEXTURE0);
          if (opts.feedback) fb = [b, a];
        } else {
          g.bindFramebuffer(g.FRAMEBUFFER, null);
          g.viewport(0, 0, f.w, f.h);
          set(f.w, f.h, t, s);
          g.drawArrays(g.TRIANGLES, 0, 3);
        }
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

/** Um número aleatório repetível a partir de um inteiro (sem estado). */
export const hashN = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** O mesmo que `vivid` no GLSL: a cor da capa mais saturada e com luz mínima (escreve em `out`, 0..1). */
export const vividInto = (out: number[], c: readonly number[], mix = 1) => {
  const l0 = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let r = l0 + (c[0] - l0) * 1.35, g = l0 + (c[1] - l0) * 1.35, b = l0 + (c[2] - l0) * 1.35;
  const l = Math.max(0.001, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const k = Math.max(1, 0.42 / l);
  r *= k; g *= k; b *= k;
  out[0] = Math.min(1, Math.max(0, r * mix + out[0] * (1 - mix)));
  out[1] = Math.min(1, Math.max(0, g * mix + out[1] * (1 - mix)));
  out[2] = Math.min(1, Math.max(0, b * mix + out[2] * (1 - mix)));
  return out;
};

/** Um sprite redondo e desfocado (para brilhos), numa cor; cria-se fora do frame. */
export const glowSprite = (size: number, rgb: readonly number[], core = 0.15): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const s = (a: number, w = 0) => `rgba(${Math.round((rgb[0] + (1 - rgb[0]) * w) * 255)},${Math.round((rgb[1] + (1 - rgb[1]) * w) * 255)},${Math.round((rgb[2] + (1 - rgb[2]) * w) * 255)},${a})`;
  g.addColorStop(0, s(1, 0.85));
  g.addColorStop(core, s(0.9, 0.4));
  g.addColorStop(0.4, s(0.25));
  g.addColorStop(1, s(0));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
};

/** Mudou a paleta da música? (compara as três cores sem alocar). */
export class PaletteWatch {
  private a = ""; private b = ""; private c = "";
  changed(colors: readonly string[]): boolean {
    if (colors[0] === this.a && colors[1] === this.b && colors[2] === this.c) return false;
    this.a = colors[0]; this.b = colors[1]; this.c = colors[2];
    return true;
  }
  reset() { this.a = ""; }
}
