/**
 * Limalha de ferro: três ímanes debaixo de uma folha de papel e milhares de
 * limalhas a alinharem-se com o campo (dipolos a sério). Os ímanes andam
 * devagar no compasso, os graves dão-lhes força (as limalhas crescem e
 * escurecem perto deles), cada batida faz a folha tremer e as limalhas
 * saltarem, a queda gira os ímanes depressa.
 */
import { FIS_HEAD, gpuScene } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const SHOW = FIS_HEAD + `
vec2 field(vec2 p){
  vec2 b = vec2(0.);
  for(int i=0;i<3;i++){
    vec2 r = p - P[i].xy;
    float l2 = dot(r,r) + .002;
    float l = sqrt(l2);
    vec2 m = vec2(cos(P[i].z), sin(P[i].z))*P[i].w;
    vec2 rh = r/l;
    b += (3.*dot(m,rh)*rh - m)/(l2*l);
  }
  return b;
}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float filings(vec2 p, float cell, float seed, out float strength){
  vec2 g = floor(p/cell), best = vec2(0.);
  float d = 9.;
  strength = 0.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 c = g + vec2(i,j);
    vec2 h = hash22(c + seed);
    vec2 ctr = (c + h)*cell + (hash22(c+P[3].z)-.5)*cell*P[3].y;
    vec2 B = field(ctr);
    float s = length(B);
    vec2 dir = B/(s + 1e-5);
    // um pouco de desalinho ao acaso (as limalhas não são perfeitas)
    float a = (h.x - .5)*.5/(1. + s*.3);
    dir = mat2(cos(a), -sin(a), sin(a), cos(a))*dir;
    float len = cell*(.25 + .45*smoothstep(.0, 6., s))*(.7 + .6*h.y);
    float dd = seg(p, ctr - dir*len, ctr + dir*len);
    if(dd < d){ d = dd; strength = s; }
  }
  return d;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p += (hash22(vec2(floor(T*30.)))-.5)*.004*P[3].x;
  // papel
  vec3 paper = mix(vec3(.93,.91,.86), vivid(C1), .12)*(.94 + .06*fbm(p*14.));
  float s1, s2;
  float px = 1./R.y;
  float d1 = filings(p, .016, 0., s1), d2 = filings(p + .008, .016, 7.3, s2);
  float w = px*(.9 + .5*P[3].x);
  float ink1 = smoothstep(w*1.6, w*.4, d1)*smoothstep(.0, 1.2, s1), ink2 = smoothstep(w*1.6, w*.4, d2)*smoothstep(.0, 1.2, s2);
  vec3 iron = mix(vec3(.08,.08,.1), vivid(C2)*.35, .25);
  vec3 c = paper;
  c = mix(c, iron, ink1*.92);
  c = mix(c, iron*1.2, ink2*.8);
  // os ímanes a transparecer por baixo do papel
  for(int i=0;i<3;i++){
    vec2 r = p - P[i].xy;
    float a = P[i].z;
    vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a))*r;
    float bar = smoothstep(.01, .0, max(abs(q.x) - .085, abs(q.y) - .026));
    vec3 pole = q.x > 0. ? vivid(C1) : vivid(C3);
    c = mix(c, c*mix(vec3(1.), pole, .65), bar*.65);
  }
  c *= 1. - .3*dot(p,p);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "limalha",
  name: "Limalha de ferro",
  names: { en: "Iron filings", lv: "Dzelzs skaidas" },
  families: ["calm", "retro"],
  tags: ["íman", "papel", "linhas", "ciência"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "ink",
}, [SHOW], (g) => {
  const show = g.full(SHOW);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  const ang = new Float32Array([0.3, 2.2, 4.1]), spin = new Float32Array([0, 0, 0]);
  let shake = 0, jump = 0, seed = 0;
  return {
    resize() {},
    frame(_g, f) {
      const s = g.s, P = g.P;
      const dt = g.env.reduceMotion ? 0 : Math.min(0.05, f.dt);
      if (beat.hit(s)) { shake = 1; jump = 0.15 + 0.35 * s.bass; seed = Math.random() * 50; }
      if (sec.hit(s) && sec.big) for (let i = 0; i < 3; i++) spin[i] = (i % 2 ? -1 : 1) * (4 + Math.random() * 4);
      shake *= Math.exp(-dt * 10);
      jump *= Math.exp(-dt * 8);
      const bar = g.env.reduceMotion ? 2.3 : s.bar;
      for (let i = 0; i < 3; i++) {
        spin[i] *= Math.exp(-dt * 1.2);
        ang[i] += (0.15 + spin[i]) * dt * (i === 1 ? -1 : 1);
        const a = bar * 0.12 + (i * Math.PI * 2) / 3;
        P[i * 4] = Math.cos(a) * 0.3 * (1 + 0.3 * Math.sin(bar * 0.07 + i)) * (g.w / g.h) * 0.7;
        P[i * 4 + 1] = Math.sin(a) * 0.22;
        P[i * 4 + 2] = ang[i];
        P[i * 4 + 3] = 0.012 * (0.7 + 1.1 * s.bass + 0.3 * s.beat);
      }
      P[12] = shake; P[13] = jump; P[14] = seed;
      g.pass(show, null);
    },
  };
});
