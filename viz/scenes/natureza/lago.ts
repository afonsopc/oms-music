/**
 * Gotas no lago: um lago parado ao fim do dia, com o céu e a lua nas cores
 * da capa reflectidos. Cada batida deixa cair uma gota (os graves fazem-na
 * maior) e os anéis espalham-se e cruzam-se; nas quedas cai uma pedra no
 * meio e começa a chover no lago todo.
 */
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "lago",
  name: "Gotas no lago",
  names: { en: "Drops on the lake", lv: "Lāses ezerā" },
  families: ["calm"],
  tags: ["natureza", "água", "suave", "acústico", "noite"],
  intensity: 1,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
const float HZ = .12;
vec3 sky(vec2 d){
  // d.y: altura acima do horizonte (0 no horizonte), d.x: lado
  vec3 c = mix(vivid(C1)*.55, vivid(C3)*.08, smoothstep(0., .7, d.y));
  c += vivid(C2)*.35*exp(-d.y*9.);
  vec2 mp = d - vec2(.35, .3);
  float m = length(mp);
  c += mix(vec3(1.), vivid(C2), .35)*smoothstep(.065, .06, m)*(.95 + .1*BEAT);
  c += vivid(C2)*.25*exp(-m*7.);
  float st = step(.997, hash(floor(d*vec2(300.,300.))))*smoothstep(.15, .5, d.y);
  return c + st*.6;
}
float waves(vec2 q, float t){
  float h = 0.;
  for(int i=0;i<7;i++){
    vec4 g = U[i];
    float a = t - g.z;
    if(a < 0. || a > 6. || g.w <= 0.) continue;
    float d = length((q - g.xy)*vec2(1., 1.));
    float front = a*.55;
    float env = smoothstep(.0, -.08, d - front)*exp(-(front - d)*2.5)*exp(-a*.55);
    h += g.w*sin(28.*(d - front))*env/(1. + 4.*d);
  }
  float rain = U[7].x;
  if(rain > .01){
    vec2 c = q*3.; vec2 id = floor(c);
    vec2 hh = hash2(id);
    float ph = fract(t*.8 + hh.x);
    float d = length(fract(c) - .5 - (hh - .5)*.4);
    h += rain*.35*sin(40.*(d - ph*.4))*smoothstep(ph*.4 + .02, ph*.4 - .05, d)*(1. - ph)*step(.4, hh.y);
  }
  return h + .015*sin(q.x*7. + t*.7)*sin(q.y*9. - t*.5);
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float t = U[7].z;
  vec3 col;
  if(p.y > HZ){
    vec2 d = vec2(p.x, p.y - HZ);
    col = sky(d);
    float tree = HZ + .04 + .05*fbm(vec2(p.x*4., 1.)) + .03*noise(vec2(p.x*22., 3.));
    col = mix(col, vivid(C3)*.03, smoothstep(tree + .002, tree - .002, p.y));
  } else {
    float z = .35/(HZ - p.y + .02);
    vec2 q = vec2(p.x*z, z);
    float e = .02;
    float h0 = waves(q, t);
    vec2 n = vec2(waves(q + vec2(e, 0.), t) - h0, waves(q + vec2(0., e), t) - h0)/e;
    n /= (1. + z*.6);
    vec2 rd = vec2(p.x + n.x*.06, (HZ - p.y) + n.y*.05 + .002);
    vec3 refl = sky(rd);
    float tree = .04 + .05*fbm(vec2(rd.x*4., 1.)) + .03*noise(vec2(rd.x*22., 3.));
    refl = mix(refl, vivid(C3)*.03, smoothstep(tree + .004, tree - .004, rd.y));
    float fres = .35 + .65*pow(1. - clamp((HZ - p.y)*1.6, 0., 1.), 3.);
    col = refl*fres + vivid(C3)*.02;
    col += vivid(C2)*.6*max(0., n.y)*exp(-abs(p.x - .35)*6.)*.4;
    col *= smoothstep(-.7, .1, p.y)*.6 + .4;
  }
  col += U[7].y*vivid(C2)*.25;
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.25), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    let next = 0, clock = 20, rain = 0, flash = 0;
    const seed = [0.2, -0.8, 2.6, 0.6, 1.2, 4.0, -1.0, 1.6, 3.4, 0.0, 2.1, 0.8, 0.4, 0.5, 5.0, 0.7, -0.4, 2.8, 2.4, 0.9, 0.9, 3.6, 1.0, 0.6, -1.4, 1.8, 4.6, 0.5];
    let first = true;
    return (u, _t, s, dt) => {
      if (first) { first = false; u.set(seed); for (let i = 0; i < 7; i++) u[i * 4 + 2] = clock - 0.4 - i * 0.7; }
      clock += dt;
      const drop = (x: number, z: number, a: number) => {
        const k = next * 4;
        u[k] = x; u[k + 1] = z; u[k + 2] = clock; u[k + 3] = a;
        next = (next + 1) % 7;
      };
      if (beat.hit(s)) {
        const z = 1.2 + Math.random() * 3.5;
        drop((Math.random() - 0.5) * 2.4 * z * 0.6, z, 0.35 + 0.9 * s.bass);
      }
      if (sec.hit(s) && sec.big) { drop(0, 1.9, 2.2); flash = 1; }
      const want = s.section === "drop" || s.section === "chorus" || s.section === "high" ? 0.5 + 0.5 * s.energy : 0;
      rain += (want - rain) * Math.min(1, dt * 0.8);
      flash *= Math.exp(-dt * 3);
      u[28] = rain; u[29] = flash; u[30] = clock;
    };
  },
});
