/**
 * Reacção-difusão (Gray-Scott) na GPU: dois químicos que se comem e se
 * espalham desenham manchas, labirintos e corais com relevo e brilho. Cada
 * secção muda a receita (manchas, labirinto, coral, minhocas), os graves
 * fazem-na respirar, as batidas pingam gotas novas, a queda abre um anel.
 * Nasce da capa: o primeiro desenho é a capa a desfazer-se.
 */
import { FIS_HEAD, gpuScene, Stepper, type Pair } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const SEED = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR;
  vec2 old = texture(S0, u).xy;
  float a = R.x/R.y;
  vec2 cu = (u-.5)*vec2(a,1.)*1.15 + .5;
  float cov = lum(texture(COVER, vec2(cu.x, 1.-cu.y)).rgb);
  float inside = step(0.,cu.x)*step(cu.x,1.)*step(0.,cu.y)*step(cu.y,1.);
  float b = inside * step(.55, fract(cov*5.)) * step(.4, hash(floor(gl_FragCoord.xy/2.)));
  b = max(b, step(.996, hash(gl_FragCoord.xy + 7.)));
  // o que já lá estava fica a desvanecer (troca de música sem corte)
  b = max(b, old.y*P[7].x);
  o = vec4(mix(1., old.x, P[7].x*.5), b*.5, 0., 1.);
}`;

const SIM = FIS_HEAD + `
void main(){
  vec2 px = 1./SR, u = gl_FragCoord.xy*px;
  vec2 c = texture(S0,u).xy;
  vec2 l = -c
    + .2*(texture(S0,u+vec2(px.x,0)).xy + texture(S0,u-vec2(px.x,0)).xy + texture(S0,u+vec2(0,px.y)).xy + texture(S0,u-vec2(0,px.y)).xy)
    + .05*(texture(S0,u+px).xy + texture(S0,u-px).xy + texture(S0,u+vec2(px.x,-px.y)).xy + texture(S0,u+vec2(-px.x,px.y)).xy);
  // a receita da secção, a variar devagar pelo ecrã (zonas de manchas e de labirinto ao mesmo tempo)
  float v = noise(u*vec2(R.x/R.y,1.)*1.6 + P[0].w*.03);
  float f = P[0].x + .004*(v-.5) + .002*P[0].z;
  float k = P[0].y + .0012*(v-.5);
  float r = c.x*c.y*c.y;
  vec2 n = c + vec2(l.x - r + f*(1.-c.x), .5*l.y + r - (k+f)*c.y);
  vec2 q = u*vec2(R.x/R.y,1.);
  for(int i=1;i<5;i++){
    vec4 g = P[i];
    if(g.w <= 0.) continue;
    float d = length(q - g.xy*vec2(R.x/R.y,1.));
    float ring = g.z < 0. ? smoothstep(.007,.0,abs(d + g.z)) : smoothstep(g.z, g.z*.4, d);
    n.y = mix(n.y, .9, ring*g.w);
  }
  o = vec4(clamp(n,0.,1.),0.,1.);
}`;

const SHOW = FIS_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec2 e = 1./SR*1.5;
  float b = texture(S0,u).y;
  float bx = texture(S0,u+vec2(e.x,0)).y - texture(S0,u-vec2(e.x,0)).y;
  float by = texture(S0,u+vec2(0,e.y)).y - texture(S0,u-vec2(0,e.y)).y;
  vec3 n = normalize(vec3(-bx*6., -by*6., 1.));
  vec3 L = normalize(vec3(-.5,.6,.8));
  float dif = max(dot(n,L),0.);
  float spec = pow(max(dot(reflect(-L,n), vec3(0,0,1)),0.), 32.);
  float m = smoothstep(.08,.32,b);
  vec3 bg = vivid(C1)*.08 + .02;
  vec3 ink = vivid(pal(b*.9 + u.x*.55 - u.y*.35 + T*.02));
  vec3 c = mix(bg, ink*(.3+.85*dif), m);
  c += spec*m*(.35 + .9*BEAT + .6*H)*mix(vec3(1.), vivid(C3), .35);
  c += vivid(C2)*m*m*.25*B;
  vec2 p = uv-.5; c *= 1.-.55*dot(p,p);
  c = mix(c, vec3(1.), DROP*DROP*.25);
  o = vec4(post(aces(c*1.15), gl_FragCoord.xy), 1.);
}`;

// coral, labirinto, impressão digital, buracos, ondas, manchas
const RECIPES = [[0.0545, 0.062], [0.029, 0.057], [0.037, 0.06], [0.039, 0.058], [0.026, 0.055], [0.034, 0.0618]];

export default gpuScene({
  id: "turing",
  name: "Reacção-difusão",
  names: { en: "Reaction-diffusion", lv: "Reakcija-difūzija" },
  families: ["calm", "chaos"],
  tags: ["orgânico", "simulação", "padrões", "relevo"],
  intensity: 2,
  cost: 2,
  signals: ["bass", "high", "beat", "drop", "section", "palette", "cover"],
  lyrics: "ink",
}, [SEED, SIM, SHOW], (g) => {
  const seed = g.full(SEED), sim = g.full(SIM), show = g.full(SHOW);
  const st = new Stepper(60, 3, 160);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  let field: Pair | null = null;
  let fresh = true, keep = 0, recipe = 0, f = 0.0545, k = 0.062, slot = 1, ringR = 0, ringW = 0, ringX = 0.5, ringY = 0.5;

  const reseed = () => {
    if (!field) return;
    g.P[28] = keep;
    g.pass(seed, field.write, field.read);
    field.swap();
    fresh = false;
  };

  return {
    resize(w, h) {
      g.free(field);
      const sw = Math.max(64, Math.round(w / 2.6)), sh = Math.max(64, Math.round(h / 2.6));
      field = g.pair(sw, sh, { fmt: "f16", linear: true, repeat: true });
      keep = 0;
      fresh = true;
      st.reset();
    },
    song() { keep = 1; fresh = true; },
    frame(g2, f2) {
      if (!field) return;
      const s = g.s;
      if (fresh) reseed();
      if (sec.hit(s)) {
        recipe = (s.sectionGroup >= 0 ? s.sectionGroup : recipe + 1) % RECIPES.length;
        if (sec.big) { ringR = 0; ringW = 1; ringX = 0.5; ringY = 0.5; }
      }
      f += (RECIPES[recipe][0] - f) * Math.min(1, f2.dt * 0.6);
      k += (RECIPES[recipe][1] - k) * Math.min(1, f2.dt * 0.6);
      const P = g.P;
      P[0] = f; P[1] = k; P[2] = s.bass; P[3] = g.t;
      for (let i = 4; i < 20; i++) P[i] = 0;
      // uma gota por batida (maior com os graves); a queda abre um anel que cresce
      if (beat.hit(s)) {
        const o = 4 + 4 * slot;
        P[o] = 0.1 + 0.8 * Math.random(); P[o + 1] = 0.1 + 0.8 * Math.random(); P[o + 2] = 0.012 + 0.03 * s.bass; P[o + 3] = 1;
        slot = slot % 2 + 1;
      }
      if (ringW > 0.01) {
        ringR += f2.dt * 0.55;
        ringW *= Math.exp(-f2.dt * 0.9);
        P[16] = ringX; P[17] = ringY; P[18] = -ringR; P[19] = ringW;
      }
      const n = st.n(f2.dt, g.env);
      const iters = 6 + Math.round(6 * s.energy);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < iters; i++) {
          g.pass(sim, field.write, field.read);
          field.swap();
          if (i === 0) for (let q = 4; q < 16; q++) P[q] = 0; // as gotas só uma vez
        }
        g.tick();
      }
      g2.pass(show, null, field.read);
    },
  };
});
