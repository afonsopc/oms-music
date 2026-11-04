/**
 * Ajudantes do pacote `cidade` (não é uma cena: começa por `_`).
 *
 * `cityShader` é um `shaderScene` com mais uniformes, `X[16]`, que a cena
 * enche em JS a cada frame. Dá para o que um shader sozinho não sabe fazer:
 * guardar memória entre frames (a distância percorrida, picos que descem
 * devagar, a posição dos faders). Os primeiros 6 são sempre estes:
 *
 *   X[0] distância percorrida (integra a velocidade: graves, energia, quedas)
 *   X[1] fase dentro da batida (0..1)
 *   X[2] tipo de secção: 0 calma, 1 normal, 2 subida, 3 forte
 *   X[3] graves suavizados (lentos)
 *   X[4] energia suavizada (lenta)
 *   X[5] número da batida (inteiro)
 *
 * E `CITY`, GLSL comum: caixas, segmentos, brilho, a capa, cores de néon.
 */
import { GLSL_HEAD } from "../../lib/shader";
import { cachedProgram, prewarmProgram, sharedTriangle, uniforms } from "../../lib/gl";
import { damp } from "../../lib/ease";
import type { FrameInfo, SceneEnv, SceneHost, SceneInstance, SceneMeta, SceneModule, Signal } from "../../lib/scene";

export const CITY = GLSL_HEAD + `
uniform float X[16];
#define PI 3.14159265
#define TRAVEL X[0]
#define BPH X[1]
#define SECK X[2]
#define BASS X[3]
#define ENER X[4]
#define BEATN X[5]
float kick(){ return exp(-BPH*6.); }
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.))+min(max(d.x,d.y),0.); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float glow(float d, float w){ return w*w/(d*d+w*w); }
float hash1(float x){ return fract(sin(x*91.345)*47453.5453); }
// a capa com y para cima (a textura vem com a primeira linha da imagem em v=0)
vec3 cov(vec2 q){ q=clamp(q,.001,.999); return texture(COVER, vec2(q.x, 1.-q.y)).rgb; }
vec3 aces(vec3 x){ x=max(x,0.); return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
// uma cor da capa puxada para néon: cheia e saturada, mesmo com capas escuras
vec3 nc(float t){ vec3 c=pal(t); float m=max(max(c.r,c.g),c.b); c/=max(m,.04); float l=dot(c,vec3(.33)); return clamp(mix(vec3(l),c,1.5),0.,1.); }
vec3 ncv(vec3 c){ float m=max(max(c.r,c.g),c.b); c/=max(m,.04); float l=dot(c,vec3(.33)); return clamp(mix(vec3(l),c,1.5),0.,1.); }
`;

type Meta = Omit<SceneMeta, "layer">;
export type Update = (x: Float32Array, s: Signal, dt: number, t: number, env: SceneEnv) => void;

const NAMES = ["R", "T", "E", "B", "LM", "M", "H", "BEAT", "BAR", "ON", "PIX", "DITHER", "DROP", "SEC", "SECAGE", "C1", "C2", "C3", "COVER", "X"] as const;

const kind = (s: Signal) => {
  switch (s.section) {
    case "intro": case "breakdown": case "outro": return 0;
    case "build": return 2;
    case "drop": case "chorus": case "high": return 3;
    default: return 1;
  }
};

export const cityShader = (meta: Meta, frag: string, update?: Update, speed = 1): SceneModule => ({
  meta: { ...meta, layer: "gl" },
  prewarm: (gl) => { prewarmProgram(gl, frag); },
  create(): SceneInstance {
    let host: SceneHost | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let u: Record<(typeof NAMES)[number], WebGLUniformLocation | null> | null = null;
    const x = new Float32Array(16);
    x[0] = 37.3; // um sítio bonito para o frame parado
    return {
      init(h) {
        host = h;
        gl = h.gl;
        if (!gl) throw new Error("sem WebGL2");
        prog = cachedProgram(gl, frag);
        u = uniforms(gl, prog, NAMES);
      },
      frame(t, s, f: FrameInfo) {
        if (!gl || !prog || !u || !host) return;
        const g = gl, l = u, env = host.env, dt = env.reduceMotion ? 0 : f.dt;
        x[0] += dt * speed * (0.5 + 0.7 * s.energy + 1.3 * s.bass + 2.5 * s.drop);
        x[1] = s.beatPos - Math.floor(s.beatPos);
        x[2] = kind(s);
        x[3] = damp(x[3], s.bass, 3, dt);
        x[4] = damp(x[4], s.energy, 2, dt);
        x[5] = Math.floor(s.beatPos);
        update?.(x, s, dt, t, env);
        g.useProgram(prog);
        g.bindVertexArray(sharedTriangle(g));
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        g.viewport(0, 0, f.w, f.h);
        g.uniform2f(l.R, f.w, f.h);
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
        g.uniform1fv(l.X, x);
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, env.coverTex);
        g.uniform1i(l.COVER, 0);
        g.drawArrays(g.TRIANGLES, 0, 3);
      },
      dispose() { prog = null; host = null; gl = null; },
    };
  },
});
