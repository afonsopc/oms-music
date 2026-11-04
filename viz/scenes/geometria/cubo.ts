/**
 * Cubo mágico: um cubo 3x3 que se baralha sozinho e depois se resolve, uma
 * rodada por batida (duas por batida nos refrões), nas cores da capa.
 * Quando fica resolvido dá um clarão e volta a baralhar-se a toda a
 * velocidade. O estado é um cubo a sério (54 autocolantes), não um truque.
 */
import { HEAD, geoScene } from "./_lib";

// estado: para cada uma das 27 posições, a cor em cada uma das 6 faces (0..5; 6 = sem autocolante)
const cur = new Int8Array(27 * 6), nxt = new Int8Array(27 * 6);
const FC = new Float32Array(27);
const MAXM = 40;
const moves = new Int8Array(MAXM * 3); // eixo, camada, sentido
let nMoves = 0, solved = 0;
let phase = 0; // 0 a resolver, 1 festa, 2 a baralhar
let animT = 1, animDur = 0.3, animAx = 0, animL = 0, animDir = 1, flash = 0, wait = 0, halfBeat = -1;
let rngS = 1;
const rnd = () => { rngS = (rngS * 16807) % 2147483647; return rngS / 2147483647; };

const idx = (x: number, y: number, z: number) => (x + 1) + 3 * (y + 1) + 9 * (z + 1);
const reset = () => {
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const i = idx(x, y, z);
    cur[i * 6] = x === 1 ? 0 : 6; cur[i * 6 + 1] = x === -1 ? 1 : 6;
    cur[i * 6 + 2] = y === 1 ? 2 : 6; cur[i * 6 + 3] = y === -1 ? 3 : 6;
    cur[i * 6 + 4] = z === 1 ? 4 : 6; cur[i * 6 + 5] = z === -1 ? 5 : 6;
  }
};
// rodar um vector inteiro 90 graus à volta do eixo (como rotAx no shader)
let rx = 0, ry = 0, rz = 0;
const rot90 = (ax: number, x: number, y: number, z: number) => {
  if (ax === 0) { rx = x; ry = -z; rz = y; } else if (ax === 1) { rx = z; ry = y; rz = -x; } else { rx = -y; ry = x; rz = z; }
};
const faceVec = (f: number) => { const s = f & 1 ? -1 : 1, a = f >> 1; return [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0] as const; };
const FACEV = [faceVec(0), faceVec(1), faceVec(2), faceVec(3), faceVec(4), faceVec(5)];
const vecFace = (x: number, y: number, z: number) => (x ? (x > 0 ? 0 : 1) : y ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5);
const turn = (ax: number, L: number) => {
  nxt.set(cur);
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    if ((ax === 0 ? x : ax === 1 ? y : z) !== L) continue;
    const i = idx(x, y, z);
    rot90(ax, x, y, z);
    const j = idx(rx, ry, rz);
    for (let f = 0; f < 6; f++) {
      const v = FACEV[f];
      rot90(ax, v[0], v[1], v[2]);
      nxt[j * 6 + vecFace(rx, ry, rz)] = cur[i * 6 + f];
    }
  }
  cur.set(nxt);
};
const apply = (ax: number, L: number, dir: number) => { turn(ax, L); if (dir < 0) { turn(ax, L); turn(ax, L); } };
const pack = () => {
  for (let i = 0; i < 27; i++) {
    let v = 0;
    for (let f = 5; f >= 0; f--) v = v * 7 + cur[i * 6 + f];
    FC[i] = v;
  }
};
const scramble = () => {
  nMoves = 18 + Math.floor(rnd() * 8);
  let last = -1;
  for (let k = 0; k < nMoves; k++) {
    let ax = Math.floor(rnd() * 3);
    if (ax === last) ax = (ax + 1) % 3;
    last = ax;
    moves[k * 3] = ax; moves[k * 3 + 1] = Math.floor(rnd() * 3) - 1; moves[k * 3 + 2] = rnd() < 0.5 ? 1 : -1;
  }
};
const start = (ax: number, L: number, dir: number, dur: number) => { animAx = ax; animL = L; animDir = dir; animT = 0; animDur = dur; };

export default geoScene<"FC" | "MV" | "FLASH">({
  id: "cubo",
  name: "Cubo mágico",
  names: { en: "Magic cube", lv: "Burvju kubs" },
  families: ["electronic", "calm"],
  tags: ["3d", "puzzle", "brinquedo", "geométrico"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, HEAD + `
uniform float FC[27];
uniform vec3 MV;
uniform float FLASH;
vec3 rotAx(vec3 p, float ax, float a){
  float c = cos(a), s = sin(a);
  if(ax < .5) p.yz = vec2(c*p.y - s*p.z, s*p.y + c*p.z);
  else if(ax < 1.5) p.zx = vec2(c*p.z - s*p.x, s*p.z + c*p.x);
  else p.xy = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  return p;
}
float comp(vec3 v, float ax){ return ax < .5 ? v.x : ax < 1.5 ? v.y : v.z; }
vec3 setc(vec3 v, float ax, float x){ if(ax < .5) v.x = x; else if(ax < 1.5) v.y = x; else v.z = x; return v; }
float box(vec3 p){ vec3 q = abs(p) - .4; return length(max(q,0.)) + min(max(q.x,max(q.y,q.z)),0.) - .065; }
mat3 TUMBLE;
vec3 hc; vec3 hq; float hl;
float map(vec3 pw){
  vec3 p = TUMBLE*pw;
  float ax = MV.x, L = MV.y;
  vec3 c = clamp(floor(p + .5), -1., 1.);
  if(abs(comp(c, ax) - L) < .5) c = setc(c, ax, L == 0. ? (comp(p, ax) > 0. ? 1. : -1.) : 0.);
  float d1 = box(p - c);
  vec3 q = rotAx(p, ax, -MV.z);
  vec3 c2 = setc(clamp(floor(q + .5), -1., 1.), ax, L);
  float d2 = box(q - c2);
  if(d2 < d1){ hc = c2; hq = q; hl = 1.; return d2*.9; }
  hc = c; hq = p; hl = 0.; return d1*.9;
}
vec3 stickerCol(float k){
  if(k < .5) return vivid(C1);
  if(k < 1.5) return vivid(C2);
  if(k < 2.5) return vivid(C3);
  if(k < 3.5) return vec3(.92);
  if(k < 4.5) return mix(vivid(C1), vivid(C2), .5)*.55;
  return mix(vivid(C3), vec3(1.), .55);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float a = TF*.15, b = .5 + .25*sin(TF*.09);
  mat3 ry = mat3(cos(a),0.,sin(a), 0.,1.,0., -sin(a),0.,cos(a));
  mat3 rx = mat3(1.,0.,0., 0.,cos(b),-sin(b), 0.,sin(b),cos(b));
  TUMBLE = rx*ry;
  vec3 ro = vec3(0., 0., 9.6 - .6*PK - .5*FLASH);
  vec3 rd = normalize(vec3(p, -(1.9 + .15*KICK)));
  vec3 bg = mix(C1*.08, vivid(C2)*.12, smoothstep(-.5, .6, p.y)) + vivid(C3)*.12*exp(-length(p)*3.)*(1. + 2.*FLASH);
  vec3 col = bg;
  // só marcha dentro da esfera que contém o cubo
  float bb = dot(ro, rd), cc = dot(ro, ro) - 7.;
  float disc = bb*bb - cc;
  if(disc > 0.){
    float tt = -bb - sqrt(disc), tEnd = -bb + sqrt(disc);
    float d = 1.;
    float maxS = Q > 1.5 ? 70. : 48.;
    for(int i=0;i<70;i++){
      if(float(i) >= maxS) break;
      d = map(ro + rd*tt);
      if(d < .001 || tt > tEnd) break;
      tt += d;
    }
    if(d < .01){
      vec3 pos = ro + rd*tt;
      map(pos);
      vec3 cell = hc, lq = hq - hc;
      float isL = hl;
      vec2 e = vec2(.002, 0.);
      vec3 n = normalize(vec3(map(pos+e.xyy)-map(pos-e.xyy), map(pos+e.yxy)-map(pos-e.yxy), map(pos+e.yyx)-map(pos-e.yyx)));
      // a normal no referencial do cubo (e da camada, se for a que roda)
      map(pos);
      vec3 nl = TUMBLE*n;
      if(isL > .5) nl = rotAx(nl, MV.x, -MV.z);
      vec3 an = abs(nl);
      float f = an.x > an.y && an.x > an.z ? (nl.x > 0. ? 0. : 1.) : an.y > an.z ? (nl.y > 0. ? 2. : 3.) : (nl.z > 0. ? 4. : 5.);
      vec2 fp = f < 1.5 ? lq.yz : f < 3.5 ? lq.zx : lq.xy;
      int id = int(cell.x + 1. + 3.*(cell.y + 1.) + 9.*(cell.z + 1.) + .5);
      float k = mod(floor(FC[id]/pow(7., f)), 7.);
      vec2 sq = abs(fp) - .33;
      float stk = smoothstep(.02, -.01, length(max(sq, 0.)) + min(max(sq.x, sq.y), 0.) - .05) * step(k, 5.5);
      vec3 l = normalize(vec3(.5, .8, .6));
      vec3 h = normalize(l - rd);
      float dif = max(dot(n, l), 0.);
      vec3 sc = stickerCol(k);
      vec3 body = vec3(.025);
      vec3 base = mix(body, sc, stk);
      col = base*(.25 + .85*dif) + sc*stk*(.15 + .5*BEAT*isL + .8*FLASH);
      col += vec3(1.)*pow(max(dot(n, h), 0.), stk > .5 ? 60. : 20.)*(stk > .5 ? .7 : .25);
      col += mix(bg, vivid(C2), .3)*pow(1. - max(dot(n, -rd), 0.), 4.)*.4;
    }
  }
  col *= .85 + .3*E;
  col *= 1. - .3*dot(p,p) - .2*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  extra: {
    names: ["FC", "MV", "FLASH"],
    song(env, st) {
      rngS = 1 + Math.floor(st.seed * 100000);
      reset();
      scramble();
      for (let k = 0; k < nMoves; k++) apply(moves[k * 3], moves[k * 3 + 1], moves[k * 3 + 2]);
      solved = 0; phase = 0; animT = 1; flash = 0; wait = 0;
      void env;
    },
    update(gl, u, _t, s, st) {
      const dt = st.dt;
      const beatLen = 60 / Math.max(60, Math.min(200, s.bpm || 120));
      // terminar a rodada em curso
      if (animT < 1) {
        animT = Math.min(1, animT + dt / animDur);
        if (animT >= 1) apply(animAx, animL, animDir);
      }
      const free = animT >= 1;
      const hb = Math.floor(s.beatPos * 2);
      const half = hb !== halfBeat; halfBeat = hb;
      if (phase === 0 && free) {
        const go = st.beatHit || (st.pk > 0.6 && half);
        if (solved >= nMoves) { phase = 1; wait = beatLen * 4; flash = 1; }
        else if (go) {
          // desfazer a última rodada do baralho
          const k = nMoves - 1 - solved;
          start(moves[k * 3], moves[k * 3 + 1], -moves[k * 3 + 2], Math.min(0.32, beatLen * (st.pk > 0.6 ? 0.42 : 0.6)));
          solved++;
        }
      } else if (phase === 1) {
        wait -= dt;
        if (wait <= 0) { scramble(); solved = 0; phase = 2; }
      } else if (phase === 2 && free) {
        if (solved >= nMoves) { solved = 0; phase = 0; }
        else { const k = solved; start(moves[k * 3], moves[k * 3 + 1], moves[k * 3 + 2], 0.09); solved++; }
      }
      if (st.sectionBig) flash = Math.max(flash, 0.7);
      flash = Math.max(0, flash - dt * 1.2);
      // ângulo com um pequeno ressalto no fim
      const x = animT, e = x >= 1 ? 1 : 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
      pack();
      gl.uniform1fv(u.FC, FC);
      gl.uniform3f(u.MV, animAx, animL, animT < 1 ? animDir * e * Math.PI / 2 : 0);
      gl.uniform1f(u.FLASH, flash);
    },
  },
});
