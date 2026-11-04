/**
 * O executor de shaders de ecrã inteiro: uma cena = um fragment shader.
 * Todos recebem os mesmos uniformes (ver GLSL_HEAD): tempo, resolução, o
 * sinal da música, as secções, as três cores da capa, a capa como textura e,
 * com `feedback`, o frame anterior (PREV) para efeitos de retorno.
 *
 *   export default shaderScene({ id: "plasma", ... }, GLSL_HEAD + `void main(){ ... }`);
 */
import { cachedProgram, deleteTarget, prewarmProgram, sharedTriangle, target, uniforms, type Target } from "./gl";
import type { FrameInfo, SceneHost, SceneInstance, SceneMeta, SceneModule, Signal } from "./scene";

/**
 * O cabeçalho comum: uniformes e utilitários (hash, noise, fbm, rot, pal,
 * pixuv para o efeito de píxeis, post para o pontilhado).
 *
 * Uniformes: R resolução; T tempo; E energia; B graves; LM médios-graves;
 * M médios; H agudos; BEAT impulso da batida (1 -> 0 em ~150 ms); BAR
 * compasso com fracção; ON ataque; DROP impulso de um momento grande (1 -> 0
 * em ~1,5 s); SEC intensidade da secção (0..1); SECAGE segundos desde o
 * início da secção; C1..C3 cores da capa; COVER a capa; PREV o frame
 * anterior (só com feedback); PIX, DITHER os efeitos pedidos pela app.
 */
export const GLSL_HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 R; uniform float T, E, B, LM, M, H, BEAT, BAR, ON, PIX, DITHER;
uniform float DROP, SEC, SECAGE;
uniform vec3 C1, C2, C3; uniform sampler2D COVER; uniform sampler2D PREV;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5;} return v; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec3 pal(float t){ t=fract(t); return t<.33? mix(C1,C2,t*3.) : t<.66? mix(C2,C3,(t-.33)*3.) : mix(C3,C1,(t-.66)*3.); }
vec2 pixuv(vec2 u){ if(PIX<1.) return u; vec2 g=R/PIX; return (floor(u*g)+.5)/g; }
vec3 post(vec3 c, vec2 fc){
  if(DITHER>.5){ float b=hash(floor(fc/2.)); c=floor(c*4.+b)/4.; }
  return c;
}
`;

const NAMES = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "PREV"] as const;

export interface ShaderOptions {
  /** Lê o frame anterior (PREV). Desenha-se a 60 % da resolução e estica-se para o ecrã. */
  feedback?: boolean;
  /** Escala da resolução do retorno (0,6 por omissão). */
  feedbackScale?: number;
}

type Meta = Omit<SceneMeta, "layer">;

export const shaderScene = (meta: Meta, frag: string, opts: ShaderOptions = {}): SceneModule => ({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { prewarmProgram(gl, frag); },
  create(): SceneInstance {
    let host: SceneHost | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let u: Record<(typeof NAMES)[number], WebGLUniformLocation | null> | null = null;
    let fb: [Target, Target] | null = null;
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
        if (!gl || !prog) return;
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
