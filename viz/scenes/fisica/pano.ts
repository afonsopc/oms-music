/**
 * Pano de seda: a capa impressa num pano pendurado de uma vara, simulado na
 * GPU (Verlet com restrições, 48 x 48 pontos) e desenhado em 3D com luz de
 * seda. O vento é ruído que sopra mais com a energia, cada batida é um murro
 * por trás num sítio ao acaso, os graves fazem ondular a vara, a queda é
 * uma rajada que o levanta todo.
 */
import { FIS_HEAD, gpuScene, VHEAD, type Buf } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const N = 48, SIZE = 1.65, L = SIZE / (N - 1);

const ANCHOR = `
vec3 anchor(vec2 ij){
  float x = (ij.x/${N - 1}.-.5)*${SIZE};
  return vec3(x, .9 + .03*sin(x*3. + P[0].w*2.)*P[0].z, .04*sin(x*5. + P[0].w*3.)*P[0].z);
}
`;

const INIT = FIS_HEAD + ANCHOR + `
void main(){
  vec2 ij = floor(gl_FragCoord.xy);
  vec3 a = anchor(vec2(ij.x, 0.));
  o = vec4(a.x, a.y - ij.y*${L}, .002*hash(ij), 1.);
}`;

// Verlet: S0 actual, S1 anterior
const VERLET = FIS_HEAD + ANCHOR + `
void main(){
  vec2 ij = floor(gl_FragCoord.xy);
  vec3 c = texelFetch(S0, ivec2(ij), 0).xyz, p = texelFetch(S1, ivec2(ij), 0).xyz;
  vec2 q = ij/${N - 1}.;
  float t = P[0].w;
  vec3 wind = vec3(.25*(noise(q*2.+t*.4)-.5), .1*(noise(q*3.-t*.3)-.5), noise(q*1.7+vec2(t*.6,-t*.2)) - .35)*P[1].x;
  vec3 acc = vec3(0., -2.2, 0.) + wind*5.;
  // murro (P[2] = x, y, raio, força)
  float d = length(q - P[2].xy);
  acc.z += P[2].w*exp(-d*d/(P[2].z*P[2].z))*60.;
  vec3 n = c + (c - p)*.985 + acc*DT*DT;
  if(ij.y < .5) n = anchor(ij);
  o = vec4(n, 1.);
}`;

// as restrições (Jacobi): vizinhos directos e diagonais
const RELAX = FIS_HEAD + ANCHOR + `
vec3 pull(vec3 c, ivec2 ij, ivec2 o, float rest){
  ivec2 k = ij + o;
  if(k.x < 0 || k.y < 0 || k.x > ${N - 1} || k.y > ${N - 1}) return vec3(0.);
  vec3 d = texelFetch(S0, k, 0).xyz - c;
  float l = length(d);
  return l > 1e-6 ? d*(1. - rest/l) : vec3(0.);
}
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(S0, ij, 0).xyz;
  if(ij.y == 0){ o = vec4(anchor(vec2(ij)), 1.); return; }
  float D = ${L}*1.41421;
  vec3 s = pull(c,ij,ivec2(1,0),${L}) + pull(c,ij,ivec2(-1,0),${L}) + pull(c,ij,ivec2(0,1),${L}) + pull(c,ij,ivec2(0,-1),${L});
  s += .5*(pull(c,ij,ivec2(1,1),D) + pull(c,ij,ivec2(-1,1),D) + pull(c,ij,ivec2(1,-1),D) + pull(c,ij,ivec2(-1,-1),D));
  s += .25*(pull(c,ij,ivec2(2,0),2.*${L}) + pull(c,ij,ivec2(-2,0),2.*${L}) + pull(c,ij,ivec2(0,2),2.*${L}) + pull(c,ij,ivec2(0,-2),2.*${L}));
  o = vec4(c + s*.22, 1.);
}`;

const VS = VHEAD + `
out vec3 nrm, wp;
vec3 at(ivec2 k){ return texelFetch(S0, clamp(k, ivec2(0), ivec2(${N - 1})), 0).xyz; }
void main(){
  int q = gl_VertexID / 6, v = gl_VertexID % 6;
  ivec2 cell = ivec2(q % ${N - 1}, q / ${N - 1});
  ivec2 o = v == 0 ? ivec2(0,0) : v == 1 ? ivec2(1,0) : v == 2 ? ivec2(0,1) : v == 3 ? ivec2(1,0) : v == 4 ? ivec2(1,1) : ivec2(0,1);
  ivec2 k = cell + o;
  vec3 p = at(k);
  nrm = normalize(cross(at(k+ivec2(1,0)) - at(k-ivec2(1,0)), at(k+ivec2(0,1)) - at(k-ivec2(0,1))));
  wp = p;
  uv = vec2(k)/${N - 1}.;
  // câmara em z = 2,6 a olhar para -z, distância focal 1,9
  float w = 2.6 - p.z;
  gl_Position = vec4(p.x*1.9/(R.x/R.y), p.y*1.9, (w - 2.)*.5*w, w);
}`;

const FS = FIS_HEAD + `
in vec3 nrm, wp;
void main(){
  vec3 n = normalize(nrm);
  vec3 vd = normalize(vec3(0., .0, 2.6) - wp);
  bool back = dot(n, vd) < 0.;
  if(back) n = -n;
  vec3 tex = texture(COVER, vec2(uv.x, uv.y)).rgb;
  if(back) tex = mix(vivid(C2)*.4, tex*.25, .4);
  vec3 L1 = normalize(vec3(-.5, .7, .9)), L2 = normalize(vec3(.8, -.2, .5));
  float d1 = max(dot(n, L1), 0.), d2 = max(dot(n, L2), 0.);
  vec3 h = normalize(L1 + vd);
  float sheen = pow(1. - abs(dot(n, vd)), 4.)*.25 + pow(max(dot(n, h), 0.), 60.)*.5;
  vec3 c = tex*(.2 + .95*d1) + tex*vivid(C3)*.35*d2 + sheen*mix(vec3(1.), vivid(C1), .4)*(.5 + .8*BEAT);
  o = vec4(post(aces(c*1.1), gl_FragCoord.xy), 1.);
}`;

const BG = FIS_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 c = mix(vivid(C1)*.12, vec3(.01), smoothstep(0., .9, length(p - vec2(0., .2))));
  // a vara
  float rod = smoothstep(.006, .0, abs(p.y - .33))*step(abs(p.x), .32);
  c += rod*vec3(.5,.45,.4);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "pano",
  name: "Pano de seda",
  names: { en: "Silk cloth", lv: "Zīda audums" },
  families: ["calm", "chaos"],
  tags: ["capa", "tecido", "3d", "vento", "simulação"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette", "cover"],
  lyrics: "extrude",
  artwork: "own",
}, [INIT, VERLET, RELAX, BG], (g) => {
  const init = g.full(INIT), verlet = g.full(VERLET), relax = g.full(RELAX), bg = g.full(BG);
  const mesh = g.custom(VS, FS);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  let b: Buf[] = [];
  let cur = 0, prev = 1, fresh = true, gust = 0, punch = 0, px = 0.5, py = 0.5, acc = 0, warm = false;

  return {
    resize() {
      for (const x of b) g.free(x);
      b = [g.buf(N, N, { fmt: "f32" }), g.buf(N, N, { fmt: "f32" }), g.buf(N, N, { fmt: "f32" }), g.buf(N, N, { fmt: "f32" })];
      fresh = true; warm = false;
    },
    song() { gust = 1; },
    frame(_g, f) {
      if (b.length < 4) return;
      const s = g.s, P = g.P, gl = g.gl, env = g.env;
      P.fill(0);
      P[2] = s.bass; P[3] = g.t;
      if (fresh) { g.pass(init, b[0]); g.pass(init, b[1]); cur = 0; prev = 1; fresh = false; }
      if (beat.hit(s)) { punch = 0.4 + 0.8 * s.bass; px = 0.2 + 0.6 * Math.random(); py = 0.3 + 0.6 * Math.random(); }
      if (sec.hit(s) && sec.big) gust = 1.5;
      gust *= Math.exp(-f.dt * 0.8);
      let n: number;
      if (env.reduceMotion) { n = warm ? 0 : 240; warm = true; }
      else { acc += Math.min(0.1, f.dt) * 60; n = Math.min(3, Math.floor(acc)); acc -= n; if (acc > 3) acc = 0; }
      g.dt = 1 / 60;
      for (let i = 0; i < n; i++) {
        P[4] = 0.35 + 0.9 * s.energy + 1.8 * gust;
        P[8] = px; P[9] = py; P[10] = 0.12; P[11] = punch;
        // os quatro: actual, anterior, e dois de trabalho
        const a = cur, p = prev;
        let w1 = 0;
        while (w1 === a || w1 === p) w1++;
        const w2 = 6 - a - p - w1;
        g.pass(verlet, b[w1], b[a], b[p]);
        let src = w1, dst = w2;
        for (let k = 0; k < 14; k++) { g.pass(relax, b[dst], b[src]); const t = src; src = dst; dst = t; }
        prev = a; cur = src;
        punch = 0;
        g.tick();
      }
      g.pass(bg, null);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      g.draw(mesh, null, gl.TRIANGLES, (N - 1) * (N - 1) * 6, b[cur], null, null);
      gl.disable(gl.DEPTH_TEST);
    },
  };
});
