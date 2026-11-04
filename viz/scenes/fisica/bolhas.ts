/**
 * Bolhas de sabão: bolhas a subir e a balançar, com a película a escorrer
 * (interferência de película fina: as cores mudam com a espessura, mais fina
 * no topo) e a capa reflectida. Os graves incham-nas, cada batida rebenta
 * uma (o buraco abre-se de um ponto e solta gotas), a queda rebenta todas e
 * sopra uma nuvem nova de pequenas.
 */
import { FIS_HEAD, gpuScene } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const NB = 12;

const SHOW = FIS_HEAD + `
vec3 film(float t){
  // espessura (em centenas de nm) -> cor por interferência (vermelho, verde, azul)
  vec3 l = vec3(6.5, 5.1, 4.5);
  return .5 + .5*cos(6.2831*2.*1.33*t/l*vec3(1.) + vec3(0., .3, .6));
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 bg = mix(vivid(C1)*.07, vivid(C2)*.03, uv.y) + .012;
  vec3 c = bg;
  for(int i=0;i<${NB};i++){
    vec4 b = P[i];
    if(b.z <= 0.) continue;
    vec2 d = (p - b.xy)/b.z;
    float r = length(d);
    if(r > 1.35) continue;
    float pop = b.w;
    if(pop > 0.){
      // gotas a voar no anel do rebentamento
      float a = atan(d.y, d.x);
      float k = floor(a/6.2831*28.);
      float rr = 1. + pop*.9*(.6 + .6*hash(vec2(k, float(i))));
      vec2 dp = vec2(cos((k+.5)/28.*6.2831), sin((k+.5)/28.*6.2831))*rr;
      float drop = smoothstep(.05, .0, length(d - dp))*(1. - pop);
      c += drop*vec3(.9)*.8;
      // o que resta da película: o buraco abre a partir de um ponto
      vec2 tear = vec2(cos(float(i)*2.3), sin(float(i)*2.3));
      if(length(d - tear) < pop*2.4) continue;
    }
    if(r > 1.) continue;
    float nz = sqrt(1. - r*r);
    vec3 n = vec3(d, nz);
    // espessura: mais fina em cima, a escorrer e a rodar
    float th = 3.2 + 2.2*d.y + 1.4*fbm(d*2.2 + vec2(T*.15 + float(i), -T*.2)) + .8*sin(atan(d.y,d.x)*2. + T*.4 + float(i));
    th *= .9 + .25*B;
    vec3 iri = film(th + nz*.6);
    iri = mix(iri, iri*vivid(pal(th*.15 + float(i)*.1))*1.6, .45);
    float fres = .12 + .88*pow(1. - nz, 3.);
    vec3 refl = texture(COVER, vec2(.5 + d.x*.45, .5 + d.y*.45)).rgb;
    vec3 add = iri*fres*.9 + refl*fres*.35;
    // reflexos das janelas
    add += vec3(1.)*smoothstep(.12, .0, length(d - vec2(-.42, .45)))*.9;
    add += vec3(1.)*smoothstep(.06, .0, length(d - vec2(.35, -.5)))*.4;
    // contorno
    add += iri*smoothstep(.9, 1., r)*.5;
    c = c*(1. - fres*.25) + add*(.7 + .5*BEAT);
  }
  vec2 q = uv-.5; c *= 1. - .35*dot(q,q);
  o = vec4(post(aces(c), gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "bolhas",
  name: "Bolhas de sabão",
  names: { en: "Soap bubbles", lv: "Ziepju burbuļi" },
  families: ["calm"],
  tags: ["iridescente", "suave", "brinquedo", "capa"],
  intensity: 1,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette", "cover"],
  lyrics: "ink",
}, [SHOW], (g) => {
  const show = g.full(SHOW);
  const bx = new Float32Array(NB), by = new Float32Array(NB), br = new Float32Array(NB), bp = new Float32Array(NB), ph = new Float32Array(NB), vy = new Float32Array(NB);
  const beat = new BeatEdge(2), sec = new SectionEdge();
  let aspect = 1.6;
  const born = (i: number, small: boolean, y?: number) => {
    br[i] = small ? 0.04 + 0.05 * Math.random() : 0.07 + 0.11 * Math.random();
    bx[i] = (Math.random() - 0.5) * aspect * 0.9;
    by[i] = y ?? -0.5 - br[i] - Math.random() * 0.12;
    bp[i] = -1; ph[i] = Math.random() * 6.28; vy[i] = 0.08 + 0.08 * Math.random();
  };
  for (let i = 0; i < NB; i++) born(i, false, -0.45 + Math.random() * 0.9);

  return {
    resize(w, h) { aspect = w / h; },
    song() {},
    frame(_g, f) {
      const s = g.s, P = g.P;
      const dt = g.env.reduceMotion ? 0 : Math.min(0.05, f.dt);
      if (beat.hit(s)) {
        // rebenta a maior que ainda está inteira, mas nunca deixa o ecrã com menos de seis
        let best = -1, seen = 0;
        for (let i = 0; i < NB; i++) {
          if (bp[i] >= 0 || by[i] < -0.45) continue;
          seen++;
          if (best < 0 || br[i] > br[best]) best = i;
        }
        if (best >= 0 && seen > 6) bp[best] = 0;
      }
      if (sec.hit(s) && sec.big) for (let i = 0; i < NB; i++) if (bp[i] < 0) bp[i] = Math.random() * 0.2;
      for (let i = 0; i < NB; i++) {
        if (bp[i] >= 0) {
          bp[i] += dt * 3.5;
          if (bp[i] >= 1) born(i, s.drop > 0.2, s.drop > 0.2 ? -0.45 + Math.random() * 0.6 : undefined);
          continue;
        }
        ph[i] += dt * (0.8 + s.mid);
        by[i] += vy[i] * dt * (1 + s.energy);
        bx[i] += Math.sin(ph[i]) * dt * 0.04;
        if (by[i] - br[i] > 0.55) born(i, false);
      }
      for (let i = 0; i < NB; i++) {
        const sw = 1 + 0.08 * s.bass + 0.02 * Math.sin(ph[i] * 3);
        P[i * 4] = bx[i]; P[i * 4 + 1] = by[i]; P[i * 4 + 2] = br[i] * sw; P[i * 4 + 3] = bp[i] < 0 ? 0 : Math.max(0.001, bp[i]);
      }
      g.pass(show, null);
    },
  };
});
