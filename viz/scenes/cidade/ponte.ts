/**
 * Ponte suspensa: uma ponte enorme sobre o rio à noite, os cabos cheios de
 * luzes que correm de torre em torre no compasso, o trânsito no tabuleiro,
 * as luzes vermelhas das torres a piscar na batida, e tudo reflectido na
 * água a tremer. Na queda os cabos acendem-se nas cores da capa.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "ponte",
  name: "Ponte suspensa",
  names: { en: "Suspension bridge" },
  families: ["electronic"],
  tags: ["ponte", "rio", "cidade", "noite", "reflexo"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, CITY + `
const float DECK = -.04, TOP = .36, TX = .5;
float cable(float x){
  float ax = abs(x);
  if(ax < TX){ float k = ax/TX; return mix(DECK + .03, TOP, k*k); }
  float k = (ax - TX)/(1.25 - TX);
  return mix(TOP, DECK + .01, 1. - (1. - k)*(1. - k));
}
vec3 bridge(vec2 p, float b){
  vec3 c = vec3(0.);
  float k = kick();
  vec3 cl = mix(vec3(1.,.85,.6), nc(fract(BAR*.25)), clamp(DROP*1.3 + .25*step(2.5, SECK), 0., 1.));
  // o cabo principal e as luzes que correm por ele
  float cy = cable(p.x);
  float dc = abs(p.y - cy);
  float run = exp(-abs(fract(abs(p.x)*1.3 - BAR*.5) - .5)*12.);
  float bulbs = smoothstep(.45, .2, abs(fract(p.x*90.) - .5));
  c += cl*glow(dc, .0015 + b)*(.35 + 1.6*run*(.4 + E) + DROP)*mix(.4, 1., bulbs);
  c += cl*glow(dc, .01 + b*3.)*.12*(1. + run);
  // os tirantes verticais
  if(p.y < cy && p.y > DECK && abs(p.x) < 1.25){
    float hx = abs(fract(p.x*40.) - .5)/40.;
    c += vec3(.5,.45,.4)*glow(hx, .0006 + b)*.25*(.4 + .6*run);
  }
  // as torres
  for(int i=0;i<2;i++){
    float tx = i == 0 ? -TX : TX;
    vec2 q = p - vec2(tx, 0.);
    float legs = min(abs(q.x - .02), abs(q.x + .02));
    float tower = step(legs, .006 + b)*step(p.y, TOP + .01)*step(-.18, p.y);
    float beam = step(abs(q.x), .024)*(step(abs(p.y - .3), .006) + step(abs(p.y - .15), .006));
    c += vec3(.35,.12,.08)*.35*max(tower, beam);
    c += vec3(1.,.4,.3)*.08*glow(legs, .01 + b);
    // as luzes vermelhas no topo
    c += vec3(1.,.05,.03)*(glow(length(q - vec2(.0, TOP + .02)), .005 + b)*1.4 + glow(length(q - vec2(0., TOP + .02)), .04 + b)*.25)*(.2 + 1.2*k);
  }
  // o tabuleiro e o trânsito
  float dd = abs(p.y - DECK);
  c += vec3(.4,.35,.3)*.15*step(dd, .006);
  float carsW = step(.55, hash(vec2(floor(p.x*30. - TRAVEL*1.2), 1.)));
  float carsR = step(.55, hash(vec2(floor(p.x*30. + TRAVEL*1.), 2.)));
  c += vec3(1.,.95,.8)*glow(abs(p.y - DECK - .009), .0015 + b)*carsW*smoothstep(.0, .3, fract(p.x*30. - TRAVEL*1.2))*.9;
  c += vec3(1.,.1,.05)*glow(abs(p.y - DECK - .004), .0015 + b)*carsR*.8;
  // os candeeiros do tabuleiro
  c += vec3(1.,.6,.25)*glow(length(vec2(fract(p.x*12.) - .5, (p.y - DECK - .025)*12.)), .05 + b*12.)*.25;
  return c;
}
vec3 shore(vec2 p, float b){
  // a outra margem: colinas com luzinhas
  float hz = -.14;
  float hill = hz + .05*fbm(vec2(p.x*2.5, 1.)) + .01;
  vec3 c = vec3(0.);
  if(p.y < hill && p.y > hz){
    vec2 g = floor(p*vec2(220., 300.));
    c += mix(vec3(1.,.7,.4), nc(hash(g)), .3)*step(.88 - .08*ENER, hash(g))*.6;
  }
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p *= .95 - .03*DROP;
  float hz = -.14;
  vec3 c;
  if(p.y > hz){
    c = mix(C1*.14 + vec3(.03,.02,.06), vec3(.0,.0,.015), smoothstep(hz, .5, p.y));
    c += step(.996, hash(floor(p*300.)))*.6*smoothstep(.0, .3, p.y);
    // a lua
    vec2 mq = p - vec2(.74, .3);
    c += vec3(.95,.92,.85)*smoothstep(.042, .04, length(mq))*(.8 + .2*noise(mq*60.));
    c += vec3(.6,.6,.7)*.15*exp(-length(mq)*8.);
    c += shore(p, 0.);
    c += bridge(p, 0.);
  } else {
    float dep = hz - p.y;
    vec2 w = vec2(fbm(vec2(p.x*6., p.y*60. + T*.5)) - .5, 0.)*(.01 + dep*.08);
    float ring = 0.;
    for(int i=0;i<2;i++){ float age = BPH + float(i); ring += sin((dep - age*.08)*300.)*exp(-abs(dep - age*.08)*60.)*exp(-age*2.); }
    w.x += ring*.002;
    vec2 rq = vec2(p.x + w.x, 2.*hz - p.y);
    rq.y = hz + (rq.y - hz)*(1. + dep*1.5);
    float b = .004 + dep*.03;
    c = (bridge(rq, b) + shore(rq, b))*.5;
    // reflexos esticados (as colunas de luz na água)
    c += vec3(.04,.04,.07);
    c *= .7 + .3*noise(vec2(p.x*80., p.y*300. - T*2.));
    vec2 mq = vec2(rq.x - .74, (rq.y - .3));
    c += vec3(.95,.92,.85)*.3*exp(-abs(mq.x)*40.)*step(.0, dep)*(.5 + .5*noise(vec2(p.x*40., p.y*200. + T)));
  }
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
