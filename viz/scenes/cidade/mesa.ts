/**
 * Mesa de mistura: dez canais vistos de cima. Os faders andam com as
 * faixas da música, os medidores de LED saltam, os botões piscam na
 * batida, o ecrã mostra a capa e a onda. Na queda os faders sobem todos
 * ao máximo de uma vez.
 */
import { CITY, cityShader } from "./_lib";
import { damp } from "../../lib/ease";

const BANDS = new Float32Array(10);

export default cityShader({
  id: "mesa",
  name: "Mesa de mistura",
  names: { en: "Mixing desk" },
  families: ["electronic"],
  tags: ["estúdio", "dj", "som", "clube", "capa"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "drop", "section", "cover", "palette"],
  lyrics: "extrude",
}, CITY + `
float band(float i){ return i < 2. ? B : i < 4. ? LM : i < 7. ? M : H; }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  // um pouco inclinada: mais longe em cima
  vec2 q = vec2(p.x/(1. - (p.y + .5)*.22), p.y*1.08 + .02);
  q *= 1.28 - .03*kick()*BASS;
  q.y += .07;
  float W = 1.45;
  vec3 c = vec3(.02,.02,.025);
  float desk = sdBox(q, vec2(W*.5 + .02, .52));
  vec3 metal = vec3(.07,.07,.08)*(1. + .25*noise(vec2(q.x*4., q.y*500.)));
  c = mix(c, metal, step(desk, 0.));
  float cw = W/10.;
  float ci = floor((q.x + W*.5)/cw);
  float fx = mod(q.x + W*.5, cw) - cw*.5;
  if(ci >= 0. && ci < 10. && abs(q.y) < .5){
    int ii = int(ci);
    float fad = 0.;
    for(int j=0;j<10;j++) if(j == ii) fad = X[6 + j];
    // a calha do fader e o fader
    float ty = -.32 + .44*fad;
    float trk = sdBox(vec2(fx, q.y + .1), vec2(.0025, .23));
    c = mix(c, vec3(.0), smoothstep(.002, .0, trk));
    for(int m=0;m<9;m++){ float yy = -.33 + float(m)*.055; c = mix(c, vec3(.35), smoothstep(.0015,.0, abs(q.y - yy))*step(.012, abs(fx))*step(abs(fx), .022)); }
    float cap = sdBox(vec2(fx, q.y - ty + .1), vec2(.028, .018));
    vec3 capc = mix(vec3(.75,.75,.78), nc(ci*.1), step(9., ci)*.0 + .15);
    capc *= .7 + .3*smoothstep(.02, -.02, q.y - ty + .1);
    capc = mix(capc, vec3(.05), smoothstep(.002, .0, abs(q.y - ty + .1)) );
    c *= 1. - .5*smoothstep(.03, .0, sdBox(vec2(fx - .006, q.y - ty + .1 + .008), vec2(.028,.018)));
    c = mix(c, capc, smoothstep(.002, .0, cap));
    // o medidor de LED ao lado
    float lv = clamp(band(ci)*1.15 + .15*(hash(vec2(ci, floor(T*20.))) - .5) + .2*kick()*step(ci, 3.), 0., 1.);
    vec2 mq = vec2(fx - .045, q.y + .1);
    float seg = floor((mq.y + .22)/.025);
    float sf = fract((mq.y + .22)/.025);
    if(abs(mq.x) < .007 && seg >= 0. && seg < 18.){
      float on = step(seg/18., lv);
      vec3 lc = seg < 11. ? vec3(.2,1.,.35) : seg < 15. ? vec3(1.,.75,.1) : vec3(1.,.15,.1);
      c = mix(c, lc*mix(.08, 1.4, on), step(.2, sf)*step(sf, .85));
    }
    // botões rotativos
    for(int m=0;m<3;m++){
      vec2 kq = vec2(fx, q.y - (.2 + float(m)*.075));
      float kr = length(kq);
      float a = (-.75 + 1.5*clamp(band(mod(ci + float(m)*3., 10.)) + .2*sin(T*.3 + ci + float(m)), 0., 1.))*PI;
      vec2 kd = vec2(sin(a), cos(a));
      float ptr = sdSeg(kq, vec2(0.), kd*.02);
      vec3 kc = vec3(.12)*(1. + .6*smoothstep(.02, -.02, kq.y - kq.x));
      kc = mix(kc, vec3(.9), smoothstep(.003, .0, ptr - .002));
      c = mix(c, kc, smoothstep(.026, .023, kr));
      c = mix(c, nc(float(m)*.3), smoothstep(.003, .0, abs(kr - .03))*.4*step(atan(kq.x, kq.y), a));
    }
    // o botão de corte
    vec2 bq = vec2(fx, q.y - .43);
    float bd = sdBox(bq, vec2(.025, .015));
    float lit = step(.5, hash(vec2(ci, BEATN)));
    c = mix(c, mix(vec3(.15), nc(.1 + ci*.05)*1.5, lit*(.4 + .6*kick())), smoothstep(.002, .0, bd));
  }
  // o ecrã em cima com a capa e a onda
  vec2 sq = q - vec2(0., .6);
  float sd = sdBox(sq, vec2(.4, .08));
  if(sd < 0.){
    vec3 sc = vec3(.01,.015,.03);
    vec2 aq = sq - vec2(-.34, 0.);
    if(abs(aq.x) < .065 && abs(aq.y) < .065) sc = cov(aq/.13 + .5);
    float wx = sq.x;
    float wv = (.5 + .5*sin(wx*60. - T*8.)*noise(vec2(wx*20. - T*4., 1.)))*(.2 + .8*E)*.06;
    if(wx > -.26) sc += nc(.5)*smoothstep(.003, .0, abs(sq.y) - wv)*.9;
    if(wx > -.26) sc += vec3(1.)*.8*smoothstep(.002, .0, abs(wx - (-.26 + .66*fract(T*.02))));
    c = sc;
  }
  c = mix(c, vec3(.0), smoothstep(.004, .0, abs(sd))*step(sd, .004));
  c += nc(.6)*.12*exp(-length(p - vec2(0., .3))*2.)*kick()*SEC;
  c += vec3(1.)*.06*DROP;
  c = aces(c*1.35);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, s, dt, t) => {
  // os faders vão ter com as faixas, devagar; na queda sobem todos
  const b = BANDS;
  b[0] = b[1] = s.bass; b[2] = b[3] = s.lowmid; b[4] = b[5] = b[6] = s.mid; b[7] = b[8] = s.high; b[9] = s.energy;
  for (let i = 0; i < 10; i++) {
    const wob = 0.12 * Math.sin(t * 0.4 + i * 1.7);
    const target = s.drop > 0.3 ? 1 : Math.min(1, Math.max(0, b[i] * 1.1 + wob + 0.15 * s.sectionIntensity));
    x[6 + i] = damp(x[6 + i] || 0.4, target, s.drop > 0.3 ? 14 : 3, dt);
  }
});
