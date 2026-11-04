/**
 * Gravidade: quatro estrelas num problema de N corpos a sério (no
 * processador, passo fixo) e 16 mil partículas de poeira na GPU a orbitá-las,
 * em exposição longa. As massas crescem com os graves, cada batida faz uma
 * estrela soltar um anel de poeira, cada secção recomeça com outra
 * coreografia e a queda é uma supernova: a poeira toda empurrada para fora.
 */
import { FIS_HEAD, gpuScene, Stepper, VHEAD, type Pair } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const W = 128, NP = W * W, NB = 4;

const SIM = FIS_HEAD + `
vec2 orbitAround(int k, float seed, out vec2 vel){
  vec2 h = hash22(gl_FragCoord.xy*1.13 + seed);
  float a = h.x*6.2831, r = .03 + .35*h.y*h.y;
  vec2 b = P[k].xy, d = vec2(cos(a), sin(a));
  float m = max(P[k].z, .001);
  vel = P[k+4].xy + vec2(-d.y, d.x)*sqrt(m/r)*(.9 + .2*hash(h));
  return b + d*r;
}
void main(){
  vec4 s = texelFetch(S0, ivec2(gl_FragCoord.xy), 0);
  vec2 p = s.xy, v = s.zw;
  float dt = DT;
  float id = gl_FragCoord.x + gl_FragCoord.y*${W}.;
  int home = int(mod(id, ${NB}.));
  // anel novo à volta de uma estrela (P[8].x: qual, P[8].y: que fracção das partículas)
  bool ring = P[8].y > 0. && hash(gl_FragCoord.xy + P[8].z) < P[8].y;
  if(P[8].w > 0. || STEP < 1. || ring){
    int k = ring ? int(P[8].x) : home;
    p = orbitAround(k, P[8].z, v);
  }
  vec2 a = vec2(0.);
  float near = 9.;
  for(int k=0;k<${NB};k++){
    vec2 d = P[k].xy - p;
    float r2 = dot(d,d) + .0009;
    a += P[k].z*d*inversesqrt(r2*r2*r2);
    near = min(near, r2);
  }
  v += a*dt;
  // supernova: empurrão para fora do centro de massa
  v += normalize(p - P[9].xy + 1e-4)*P[9].z;
  p += v*dt;
  // engolida ou perdida: volta a nascer à volta da sua estrela
  if(near < .00012 || dot(p,p) > 16.){ p = orbitAround(home, STEP*.37, v); }
  o = vec4(p, v);
}`;

const VS = VHEAD + `
out vec3 col;
void main(){
  int i = gl_VertexID;
  vec4 s = texelFetch(S0, ivec2(i % ${W}, i / ${W}), 0);
  vec2 p = s.xy*P[10].x;
  gl_Position = vec4(p.x*R.y/R.x, p.y, 0., 1.);
  gl_PointSize = P[10].y;
  float sp = length(s.zw);
  vec3 c = vivid(pal(float(i % ${NB})/${NB}.*.999 + .1));
  col = mix(c, vec3(1.), clamp(sp*.25 - .2, 0., .8))*P[10].z;
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
  vec3 c = texture(S0, u).rgb;
  vec2 p = (u-.5)*vec2(R.x/R.y,1.)*2./P[10].x;
  // as estrelas: núcleo branco e halo da cor
  for(int k=0;k<${NB};k++){
    float d = length(p - P[k].xy);
    float m = P[k].z;
    vec3 sc = vivid(pal(float(k)/${NB}.*.999 + .1));
    c += sc*(.012*m/(d*d + .0004))*.12 + vec3(1.)*smoothstep(.02*sqrt(m)+.004, 0., d);
  }
  c += vivid(C1)*.02;
  c = mix(c, vec3(1.), P[9].w*.6);
  vec2 q = uv-.5; c *= 1.-.4*dot(q,q);
  o = vec4(post(aces(c), gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "gravidade",
  name: "Gravidade",
  names: { en: "Gravity", lv: "Gravitācija" },
  families: ["calm", "chaos"],
  tags: ["espaço", "estrelas", "partículas", "simulação", "órbitas"],
  intensity: 3,
  cost: 2,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, [SIM, FADE, SHOW], (g) => {
  const sim = g.full(SIM), fade = g.full(FADE), show = g.full(SHOW), pts = g.custom(VS, FS);
  const st = new Stepper(60, 3, 180);
  const beat = new BeatEdge(2), sec = new SectionEdge();
  const bx = new Float64Array(NB), by = new Float64Array(NB), vx = new Float64Array(NB), vy = new Float64Array(NB), m0 = new Float64Array(NB), m = new Float64Array(NB);
  let parts: Pair | null = null, trail: Pair | null = null;
  let reset = 1, ringK = -1, ringF = 0, nova = 0, flash = 0, cfg = 0;

  const setup = () => {
    cfg++;
    // uma estrela pesada e três à volta, ou dois pares, conforme a vez
    const pairs = cfg % 2 === 0;
    for (let k = 0; k < NB; k++) {
      const a = (k / NB) * Math.PI * 2 + cfg;
      if (pairs) {
        const c = k < 2 ? -0.45 : 0.45, sgn = k % 2 ? 1 : -1;
        bx[k] = c + sgn * 0.09; by[k] = sgn * 0.05; m0[k] = 0.12;
        vx[k] = 0; vy[k] = (k < 2 ? -0.22 : 0.22) + sgn * 0.55;
      } else if (k === 0) { bx[k] = 0; by[k] = 0; vx[k] = 0; vy[k] = 0; m0[k] = 0.5; }
      else {
        const r = 0.3 + 0.18 * k;
        bx[k] = Math.cos(a) * r; by[k] = Math.sin(a) * r; m0[k] = 0.05;
        const v = Math.sqrt(0.5 / r);
        vx[k] = -Math.sin(a) * v; vy[k] = Math.cos(a) * v;
      }
    }
    // tirar o movimento do centro de massa
    let M = 0, px = 0, py = 0;
    for (let k = 0; k < NB; k++) { M += m0[k]; px += m0[k] * vx[k]; py += m0[k] * vy[k]; }
    for (let k = 0; k < NB; k++) { vx[k] -= px / M; vy[k] -= py / M; m[k] = m0[k]; }
    reset = 1;
  };
  const nbody = (dt: number) => {
    for (let k = 0; k < NB; k++) {
      let ax = 0, ay = 0;
      for (let j = 0; j < NB; j++) {
        if (j === k) continue;
        const dx = bx[j] - bx[k], dy = by[j] - by[k], r2 = dx * dx + dy * dy + 0.004;
        const f = m[j] / (r2 * Math.sqrt(r2));
        ax += dx * f; ay += dy * f;
      }
      vx[k] += ax * dt; vy[k] += ay * dt;
    }
    for (let k = 0; k < NB; k++) {
      bx[k] += vx[k] * dt; by[k] += vy[k] * dt;
      // muro suave: ninguém foge do ecrã
      const r = Math.hypot(bx[k], by[k]);
      if (r > 0.85) { vx[k] -= (bx[k] / r) * (r - 0.85) * dt * 8; vy[k] -= (by[k] / r) * (r - 0.85) * dt * 8; }
    }
  };
  setup();

  return {
    resize(w, h) {
      g.free(parts); g.free(trail);
      parts = g.pair(W, W, { fmt: "f32" });
      trail = g.pair(Math.max(64, Math.round(w / 1.5)), Math.max(64, Math.round(h / 1.5)), { linear: true });
      reset = 1;
      st.reset();
    },
    song() { setup(); },
    frame(_g, f) {
      if (!parts || !trail) return;
      const s = g.s, P = g.P;
      if (sec.hit(s)) { if (sec.big) { nova = 1; flash = 1; } else setup(); }
      if (beat.hit(s)) { ringK = Math.floor(Math.random() * NB); ringF = 0.02 + 0.04 * s.bass; }
      for (let k = 0; k < NB; k++) m[k] = m0[k] * (0.8 + 0.6 * s.bass);
      const n = st.n(f.dt, g.env);
      for (let i = 0; i < n; i++) {
        const dt = 1 / 60;
        for (let j = 0; j < 4; j++) nbody(dt / 4);
        P.fill(0);
        let cmx = 0, cmy = 0, M = 0;
        for (let k = 0; k < NB; k++) {
          P[k * 4] = bx[k]; P[k * 4 + 1] = by[k]; P[k * 4 + 2] = m[k];
          P[16 + k * 4] = vx[k]; P[17 + k * 4] = vy[k];
          cmx += bx[k] * m[k]; cmy += by[k] * m[k]; M += m[k];
        }
        // P[8] = (estrela do anel, fracção, semente, recomeçar); P[9] = (centro, empurrão, clarão); P[10] = (escala, ponto, brilho)
        P[32] = Math.max(0, ringK); P[33] = ringK >= 0 ? ringF : 0; P[34] = Math.random() * 100; P[35] = reset;
        P[36] = cmx / M; P[37] = cmy / M; P[38] = nova * 1.2;
        P[40] = 0.95; P[41] = Math.max(1.2, g.h / 600); P[42] = 0.16 + 0.1 * s.high;
        g.dt = dt;
        g.pass(sim, parts.write, parts.read);
        parts.swap();
        g.tick();
        reset = 0; ringK = -1; nova = 0;
        // rasto: esmorecer e pintar a poeira por cima
        P[0] = 0.97 - 0.03 * s.energy;
        g.pass(fade, trail.write, trail.read);
        for (let k = 0; k < 4; k++) P[k] = 0;
        g.draw(pts, trail.write, g.gl.POINTS, g.env.lowPower ? NP >> 1 : NP, parts.read, null, "add");
        trail.swap();
        for (let k = 0; k < NB; k++) { P[k * 4] = bx[k]; P[k * 4 + 1] = by[k]; P[k * 4 + 2] = m[k]; P[k * 4 + 3] = 0; }
      }
      P[39] = flash; P[40] = 0.95; P[41] = Math.max(1.2, g.h / 600); P[42] = 0.16 + 0.1 * s.high;
      flash *= Math.exp(-f.dt * 4);
      g.pass(show, null, trail.read);
    },
  };
});
