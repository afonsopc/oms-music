/**
 * Ampulheta: areia a sério na GPU (autómato de blocos 2x2 de Margolus: os
 * grãos caem, escorregam e fazem montes com o seu ângulo), em camadas com as
 * cores da capa, a passar pelo gargalo. A energia dá a pressa, cada batida
 * é uma pancadinha no vidro (a areia salta e corre), e a cada oito compassos
 * ou numa queda a ampulheta dá a volta e tudo recomeça ao contrário.
 */
import { FIS_HEAD, gpuScene, type Pair } from "./_lib";
import { BarEdge, SectionEdge } from "../../lib/beat";

const SHAPE = `
float halfw(float y){
  float a = abs(y);
  return .04 + .56*smoothstep(.02,.5,a)*(1. - .55*smoothstep(.7,.98,a));
}
// q: a grelha em -1..1 (a largura é 0,75 da altura)
bool wallq(vec2 q){ return abs(q.y) > .93 || abs(q.x*.75) > halfw(q.y); }
bool wall(vec2 c){ return wallq((c + .5)/SR*2. - 1.); }
`;

const INIT = FIS_HEAD + SHAPE + `
void main(){
  vec2 c = floor(gl_FragCoord.xy);
  vec2 q = (c+.5)/SR*2.-1.;
  bool sand = !wall(c) && q.y > .12 + .05*sin(q.x*9.);
  float col = fract(q.y*1.7 + .08*hash(c));
  o = vec4(sand ? 1. : 0., col, 0., 1.);
}`;

const STEP_ = FIS_HEAD + SHAPE + `
vec4 cellAt(vec2 c){ return wall(c) ? vec4(2., 0., 0., 1.) : texelFetch(S0, ivec2(c), 0); }
void main(){
  vec2 c = floor(gl_FragCoord.xy);
  float off = mod(STEP, 2.);
  vec2 b = floor((c - off)/2.)*2. + off;
  float g = P[0].x; // 1: cai para baixo (y-), -1: para cima
  // tl, tr: em cima (contra a gravidade); bl, br: em baixo
  vec2 ct = g > 0. ? b + vec2(0,1) : b, cb = g > 0. ? b : b + vec2(0,1);
  vec4 tl = cellAt(ct), tr = cellAt(ct+vec2(1,0)), bl = cellAt(cb), br = cellAt(cb+vec2(1,0));
  float r = hash(b*1.731 + STEP*.137);
  bool shake = hash(b + 3.1 + STEP) < P[0].y;
  // espelhar ao acaso para não haver lado preferido
  bool flip = r < .5;
  if(flip){ vec4 t = tl; tl = tr; tr = t; t = bl; bl = br; br = t; }
  bool sTL = tl.x == 1., sTR = tr.x == 1.;
  bool eBL = bl.x == 0., eBR = br.x == 0.;
  if(!(shake && r > .25)){
    if(sTL && eBL){ vec4 t = tl; tl = bl; bl = t; sTL = false; eBL = false; }
    if(sTR && eBR){ vec4 t = tr; tr = br; br = t; sTR = false; eBR = false; }
    // escorregar na diagonal (com algum atrito: os montes ficam com ângulo)
    float fr = hash(b*2.37 + STEP*.71);
    if(sTL && !eBL && eBR && fr < .9){ vec4 t = tl; tl = br; br = t; }
    else if(sTR && !eBR && eBL && fr < .9){ vec4 t = tr; tr = bl; bl = t; }
  } else {
    // pancada: os de baixo saltam para cima
    if(bl.x == 1. && tl.x == 0.){ vec4 t = tl; tl = bl; bl = t; }
  }
  if(flip){ vec4 t = tl; tl = tr; tr = t; t = bl; bl = br; br = t; }
  vec4 me = c == ct ? tl : c == ct+vec2(1,0) ? tr : c == cb ? bl : br;
  if(me.x == 2.) me = vec4(0.);
  o = me;
}`;

const SHOW = FIS_HEAD + SHAPE + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  // a ampulheta a rodar (P[1].x) e a tremer na batida
  p += vec2(sin(T*70.), cos(T*53.))*.003*P[1].y;
  p = rot(-P[1].x)*p;
  float sc = P[1].z;
  vec2 X = p/sc;                     // físico: altura -1..1
  vec2 q = vec2(X.x/.75, X.y);       // grelha -1..1
  vec2 G = P[2].xy;
  vec2 gc = (q*.5 + .5)*G;
  vec3 bg = mix(vec3(.01,.01,.02), vivid(C1)*.06, smoothstep(1.2,0.,length(p)));
  vec3 c = bg;
  float hw = halfw(X.y);
  if(!wallq(q) && gc.x >= 0. && gc.y >= 0. && gc.x < G.x && gc.y < G.y){
    vec4 s = texelFetch(S0, ivec2(gc), 0);
    vec2 f = fract(gc)-.5;
    if(s.x > .5){
      float n = hash(floor(gc));
      vec3 sand = vivid(pal(s.y));
      sand *= .82 + .22*n;
      sand *= 1. - .7*dot(f,f);
      c = sand;
    } else c = bg*1.6 + .02;
  }
  // o vidro: contorno e reflexos
  float edge = abs(abs(X.x) - hw)*sc;
  float glass = smoothstep(.006, .0, edge)*step(abs(X.y), .93);
  c += glass*vec3(.5)*(.6 + .6*BEAT);
  c += step(abs(X.y), .9)*smoothstep(.02,.0, abs(X.x + hw*.6))*smoothstep(.2,.5,abs(X.y))*.07;
  // tampas de madeira em cima e em baixo
  float cap = step(.93, abs(X.y))*step(abs(X.y), 1.)*step(abs(X.x), .7);
  c = mix(c, vivid(C2)*.25 + vec3(.06,.04,.02), cap);
  c += cap*smoothstep(.97,1.,abs(X.y))*.08;
  vec2 v = uv-.5; c *= 1.-.4*dot(v,v);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "ampulheta",
  name: "Ampulheta",
  names: { en: "Hourglass", lv: "Smilšu pulkstenis" },
  families: ["calm", "retro"],
  tags: ["areia", "tempo", "simulação", "partículas"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "beat", "bar", "drop", "section", "palette"],
  lyrics: "ink",
}, [INIT, STEP_, SHOW], (g) => {
  const init = g.full(INIT), step = g.full(STEP_), show = g.full(SHOW);
  const bars = new BarEdge(8), sec = new SectionEdge();
  let field: Pair | null = null;
  let fresh = true, grav = 1, rotA = 0, rotT = 0, shake = 0, acc = 0, warm = false;

  return {
    resize(_w, h) {
      g.free(field);
      const gh = Math.max(96, Math.round(h / 2.6)), gw = Math.max(64, Math.round(gh * 0.75));
      field = g.pair(gw, gh, { fmt: "u8" });
      fresh = true; grav = 1; rotA = 0; rotT = 0; warm = false;
    },
    song() { fresh = true; grav = 1; rotT = 0; rotA = 0; },
    frame(_g, f) {
      if (!field) return;
      const s = g.s, P = g.P, env = g.env;
      if (fresh) { g.pass(init, field.write); field.swap(); fresh = false; }
      if ((sec.hit(s) && sec.big) || bars.hit(s)) { grav = -grav; rotT += Math.PI; }
      rotA += (rotT - rotA) * Math.min(1, f.dt * 3.5);
      if (s.beat > 0.9) shake = Math.max(shake, 0.04 + 0.1 * s.bass);
      // passes por frame: 3 a 8 com a energia (passo fixo pelo tempo)
      let n: number;
      if (env.reduceMotion) { n = warm ? 0 : 900; warm = true; }
      else { acc += Math.min(f.dt, 0.1) * 60 * (3 + 5 * s.energy); n = Math.min(12, Math.floor(acc)); acc -= n; if (acc > 12) acc = 0; }
      for (let i = 0; i < n; i++) {
        P.fill(0);
        P[0] = grav; P[1] = shake;
        g.pass(step, field.write, field.read);
        field.swap();
        g.tick();
        shake *= 0.8;
      }
      P[4] = rotA; P[5] = s.beat; P[6] = 0.46; P[7] = g.t; P[8] = field.read.w; P[9] = field.read.h;
      g.pass(show, null, field.read);
    },
  };
});
