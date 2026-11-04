/**
 * Pêndulo duplo: 2048 pêndulos que partem quase do mesmo sítio (diferem
 * em milésimos de radiano). Andam juntos uns segundos e depois
 * o caos abre-os num leque com as cores da capa, a desenhar rastos. A
 * gravidade pulsa com os graves, as batidas dão um empurrão a todos, cada
 * queda volta a juntá-los num lançamento novo.
 */
import { FIS_HEAD, gpuScene, Stepper, VHEAD, type Pair } from "./_lib";
import { BarEdge, SectionEdge } from "../../lib/beat";

const W = 64, H = 32, N = W * H;

const SIM = FIS_HEAD + `
vec2 acc(vec4 s, float g){
  float t1=s.x, t2=s.y, w1=s.z, w2=s.w, d=t1-t2;
  float den = 3. - cos(2.*d);
  float a1 = (-3.*g*sin(t1) - g*sin(t1-2.*t2) - 2.*sin(d)*(w2*w2 + w1*w1*cos(d)))/den;
  float a2 = (2.*sin(d)*(2.*w1*w1 + 2.*g*cos(t1) + w2*w2*cos(d)))/den;
  return vec2(a1,a2);
}
vec4 f(vec4 s, float g){ return vec4(s.zw, acc(s,g)); }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(S0, c, 0);
  float i = float(c.y*${W} + c.x)/${N}.;
  if(P[0].w > 0. || STEP < 1.){
    // lançamento: todos no mesmo ângulo, com uma diferença ínfima
    s = vec4(P[0].x + i*P[0].z, P[0].y + i*P[0].z*.5, 0., 0.);
  }
  float g = P[1].x, h = P[1].y;
  s.zw += P[1].z;
  for(int k=0;k<4;k++){
    vec4 k1=f(s,g), k2=f(s+.5*h*k1,g), k3=f(s+.5*h*k2,g), k4=f(s+h*k3,g);
    s += h/6.*(k1+2.*k2+2.*k3+k4);
  }
  s.zw *= P[1].w;
  o = s;
}`;

const ARM = `
vec2 bob(vec4 s, int which){
  vec2 piv = vec2(0., P[2].y);
  float L = P[2].x;
  vec2 m1 = piv + L*vec2(sin(s.x), -cos(s.x));
  vec2 m2 = m1 + L*vec2(sin(s.y), -cos(s.y));
  return which == 0 ? piv : which == 1 ? m1 : m2;
}
vec4 clip(vec2 p){ return vec4(p.x*R.y/R.x, p.y, 0., 1.); }
`;

// os braços: 4 vértices por pêndulo (eixo-1, 1-2)
const VS_LINES = VHEAD + ARM + `
out vec3 col;
void main(){
  int i = gl_VertexID >> 2, v = gl_VertexID & 3;
  vec4 s = texelFetch(S0, ivec2(i % ${W}, i / ${W}), 0);
  gl_Position = clip(bob(s, v == 0 ? 0 : v == 3 ? 2 : 1));
  col = vivid(pal(float(i)/${N}.*.999 + T*.01))*P[3].x;
  uv = vec2(0.);
}`;

// o caminho do segundo peso neste passo (de onde estava, S1, para onde está, S0), para o rasto
const VS_PTS = VHEAD + ARM + `
out vec3 col;
void main(){
  int i = gl_VertexID >> 1;
  ivec2 c = ivec2(i % ${W}, i / ${W});
  vec4 s = (gl_VertexID & 1) == 0 ? texelFetch(S1, c, 0) : texelFetch(S0, c, 0);
  gl_Position = clip(bob(s, 2));
  col = vivid(pal(float(i)/${N}.*.999 + T*.01))*P[3].y;
  uv = vec2(0.);
}`;

const FS = FIS_HEAD + `
in vec3 col;
void main(){ o = vec4(col, 1.); }`;

const FADE = FIS_HEAD + `
void main(){ o = vec4(texture(S0, gl_FragCoord.xy/SR).rgb*P[0].x, 1.); }`;

const SHOW = FIS_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec3 t = texture(S0, u).rgb;
  vec3 c = vivid(C1)*.03 + t*(1. + .5*BEAT);
  vec2 p = uv-.5; c *= 1.-.45*dot(p,p);
  o = vec4(post(aces(c), gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "pendulo-duplo",
  name: "Pêndulo duplo",
  names: { en: "Double pendulum", lv: "Dubultsvārsts" },
  families: ["chaos", "calm"],
  tags: ["caos", "simulação", "rastos", "linhas"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, [SIM, FADE, SHOW], (g) => {
  const sim = g.full(SIM), fade = g.full(FADE), show = g.full(SHOW);
  const lines = g.custom(VS_LINES, FS), pts = g.custom(VS_PTS, FS);
  const st = new Stepper(60, 3, 200);
  const sec = new SectionEdge(), bars = new BarEdge(16);
  let state: Pair | null = null, trail: Pair | null = null;
  let launch = 1, a1 = 2.2, a2 = 2.6, kick = 0, beatSeen = 0;
  const relaunch = () => {
    launch = 1;
    a1 = 1.6 + Math.random() * 1.4;
    a2 = a1 + (Math.random() - 0.5) * 1.6;
  };
  return {
    resize(w, h) {
      g.free(state); g.free(trail);
      state = g.pair(W, H, { fmt: "f32" });
      trail = g.pair(Math.max(64, Math.round(w / 1.5)), Math.max(64, Math.round(h / 1.5)), { linear: true });
      launch = 1;
      st.reset();
    },
    song() { relaunch(); },
    frame(_g, f) {
      if (!state || !trail) return;
      const s = g.s, P = g.P;
      if ((sec.hit(s) && sec.big) || bars.hit(s)) relaunch();
      if (s.beat > 0.9 && beatSeen <= 0.9) kick = 0.25 + 0.6 * s.bass;
      beatSeen = s.beat;
      const n = st.n(f.dt, g.env);
      P.fill(0);
      P[8] = 0.42; P[9] = 0.3;
      for (let i = 0; i < n; i++) {
        P[0] = a1; P[1] = a2; P[2] = 2e-3; P[3] = launch;
        P[4] = 9.8 * (0.7 + 1.1 * s.bass + 0.4 * s.drop); P[5] = 1 / 240; P[6] = kick; P[7] = 0.9995;
        g.pass(sim, state.write, state.read);
        state.swap();
        g.tick();
        launch = 0;
        kick = 0;
        // o rasto do segundo peso, a esmorecer
        P[0] = 0.965 - 0.03 * s.energy;
        g.pass(fade, trail.write, trail.read);
        P[13] = 0.05 + 0.05 * s.high;
        g.draw(pts, trail.write, g.gl.LINES, N * 2, state.read, state.write, "add");
        trail.swap();
      }
      g.pass(show, null, trail.read);
      P[12] = 0.05 + 0.08 * s.beat;
      g.draw(lines, null, g.gl.LINES, N * 4, state.read, null, "add");
    },
  };
});
