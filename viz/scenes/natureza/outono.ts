/**
 * Folhas de Outono: folhas a cair e a dar voltas no ar, em três
 * profundidades, contra um bosque desfocado ao fim da tarde. Viram-se e
 * mostram o avesso mais claro contra o sol. A batida dá uma rajada, os
 * graves aceleram o vento, e nas quedas um redemoinho apanha-as todas.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "outono",
  name: "Folhas de Outono",
  names: { en: "Autumn leaves", lv: "Rudens lapas" },
  families: ["calm"],
  tags: ["natureza", "outono", "vento", "suave", "acústico", "quente"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
float leafD(vec2 q, float kind){
  // folha: em bico (faia) ou com lóbulos (plátano)
  float d;
  if(kind < .5){
    vec2 a = vec2(abs(q.x), q.y);
    d = length(a + vec2(.22, 0.)) - .34;
  } else {
    float ang = atan(q.x, q.y), r = length(q);
    float lobes = .23 + .1*pow(abs(cos(ang*2.5)), 3.) - .05*smoothstep(2.2, 3.14, abs(ang));
    d = r - lobes;
  }
  float stem = max(abs(q.x) - .012, abs(q.y + .3) - .1);
  return min(d, stem);
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float wind = U[0].x, fall = U[0].y, swirl = U[0].z, gust = U[0].w;
  // bosque desfocado
  vec3 warm = mix(vec3(.95, .55, .2), vivid(C1), .5);
  vec3 col = mix(warm*.55, vivid(C3)*.12, smoothstep(-.6, .6, p.y));
  for(int l=0;l<2;l++){
    vec2 q = p*(3. + float(l)*3.) + vec2(T*.01*(1. + float(l)), float(l)*4.);
    vec4 v = voro(q);
    float b = smoothstep(.5, .1, v.x)*step(.5, hash(v.zw + float(l)));
    col += vivid(pal(hash(v.zw)*.6 + .1))*b*(.12 - .04*float(l));
  }
  vec2 sun = vec2(.5, .38);
  col += mix(vivid(C2), vec3(1., .85, .5), .4)*(.55*exp(-length(p - sun)*3.) + .25*exp(-length(p - sun)*.8));
  for(int i=0;i<4;i++){
    float x = -1.1 + float(i)*.6 + .1*sin(float(i)*4.);
    float tw = smoothstep(.04, .02, abs(p.x - x - .05*p.y))*.6;
    col = mix(col, vivid(C3)*.04, tw);
  }
  // redemoinho nas quedas
  float rr = length(p);
  p = rot(swirl*2.2*exp(-rr*1.6))*p;
  // folhas em três camadas, do fundo para a frente
  for(int l=0;l<3;l++){
    float fl = float(l);
    float sc = 5. - fl*1.5;
    vec2 q = p*sc;
    q.x += wind*(.6 + fl*.4) + fl*7.;
    q.y += fall*(.6 + fl*.3);
    vec2 id0 = floor(q);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 id = id0 + vec2(i, j);
      vec2 h = hash2(id + fl*11.);
      if(h.x < .35 - .2*fl) continue;
      float ph = fall*(1. + h.y) + h.x*20.;
      vec2 c = id + .5 + vec2(.35*sin(ph*.7), .2*cos(ph*1.4))*(.6 + .4*gust);
      vec2 lq = q - c;
      float spin = ph*(1. + 2.*h.y) + gust*3.*h.x;
      lq = rot(spin*.6 + h.y*6.)*lq;
      float flip = cos(spin*1.3 + h.x*9.);
      lq.x /= max(abs(flip), .12);
      lq /= .55 + .35*h.y;
      float d = leafD(lq, fract(h.x*7.));
      float aa = (1.5*sc/R.y)/(.55 + .35*h.y)/max(abs(flip), .12) + (l == 2 ? .02 : 0.);
      float m = smoothstep(aa, -aa, d);
      if(m <= 0.) continue;
      vec3 lc = mix(vec3(.85, .3, .08), vec3(.95, .65, .15), fract(h.y*13.));
      lc = mix(lc, vivid(pal(h.x + h.y)), .5);
      float back = step(0., flip);
      lc *= back > .5 ? 1. : .6;
      lc += back*mix(vivid(C2), vec3(1., .8, .4), .5)*.2*smoothstep(.5, 1., abs(flip));
      float vein = smoothstep(.015, .0, abs(lq.x))*.25 + smoothstep(.01, 0., abs(abs(lq.x) - (lq.y + .2)*.4)*.7)*.1;
      lc *= 1. - vein;
      lc *= .55 + .45*fl/2.;
      col = mix(col, lc, m*(l == 2 ? .9 : 1.));
    }
  }
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.15), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const gust = new Envelope(0.08, 0.9);
    const swirl = new Envelope(0.4, 2.5);
    let wind = 0, fall = 0, w = 0, sw = 0;
    return (u, _t, s, dt) => {
      if (beat.hit(s)) gust.kick(0.3 + 0.7 * s.bass);
      if (sec.hit(s) && sec.big) swirl.kick(1);
      gust.step(0, dt); swirl.step(0, dt);
      const ws = 0.15 + 0.5 * s.bass + 1.4 * gust.v * s.sectionIntensity;
      w += (ws - w) * Math.min(1, dt * 3);
      wind += dt * w;
      fall += dt * (0.25 + 0.2 * s.energy + 0.5 * swirl.v);
      sw += dt * swirl.v * 2;
      u[0] = wind; u[1] = fall; u[2] = swirl.v * (1 + 0.3 * Math.sin(sw)); u[3] = gust.v;
    };
  },
});
