/**
 * Gira-discos: visto de cima, o disco a rodar com a capa no rótulo, o
 * brilho dos sulcos a cruzar o vinil, o braço a avançar. Cada batida passa
 * uma onda de luz pelos sulcos; na queda o DJ risca o disco para trás e
 * para a frente.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "vinil",
  name: "Gira-discos",
  names: { en: "Turntable" },
  families: ["electronic"],
  tags: ["vinil", "dj", "clube", "capa"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "cover", "palette"],
  artwork: "own",
  lyrics: "ink",
}, CITY + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec2 cc = vec2(-.12, 0.);
  float ang = X[6];
  vec3 c = vec3(.03,.03,.035);
  // a base: metal escovado com a luz da sala
  float brush = noise(vec2(p.x*600., p.y*3.));
  c = mix(vec3(.05,.05,.06), vec3(.09,.09,.1), brush*.5 + .3*smoothstep(.6,-.4,p.y + p.x*.3));
  c += C1*.08*exp(-length(p - vec2(.6,.4))*2.);
  vec2 q = p - cc;
  float r = length(q);
  // o prato e os pontos do estroboscópio
  float plat = r - .43;
  if(plat < 0.){
    c = vec3(.07,.07,.08);
    vec2 rq = rot(ang)*q;
    float a = atan(rq.y, rq.x);
    float dots = step(.5, fract(a/(2.*PI)*90.))*smoothstep(.008, .0, abs(r - .422));
    c += vec3(.5)*dots*(.4 + .6*smoothstep(.3,1.,sin(a*2.)*.5+.5));
  }
  // o vinil
  if(r < .405){
    float a = atan(q.y, q.x);
    float groove = .5 + .5*sin(r*1400.);
    float bands = smoothstep(.0, .004, abs(fract(r*11.3) - .5) - .47);
    vec3 v = vec3(.012,.012,.015) + .02*groove;
    // o brilho em cruz dos sulcos, fixo (a luz não roda)
    float sheen = pow(abs(cos(a - .7)), 18.) + .5*pow(abs(cos(a + .9)), 30.);
    v += vec3(.28,.28,.32)*sheen*(.4 + .6*groove)*bands;
    v += nc(.3)*pow(abs(cos(a - .7)), 60.)*.25*bands;
    // a onda da batida, de fora para dentro
    float w = exp(-abs(r - (.405 - BPH*.3))*40.)*exp(-BPH*2.);
    v += nc(.1)*w*.5*(.5 + E);
    v *= mix(1., .35, 1. - bands);
    c = v;
  }
  // o rótulo com a capa
  float lr = .135 + .006*BEAT;
  if(r < lr){
    vec2 lq = rot(ang)*q/(2.*lr) + .5;
    vec3 art = cov(lq);
    c = art*(.9 + .2*kick())*(1. - .25*smoothstep(lr*.7, lr, r));
  }
  c = mix(c, vec3(.75), smoothstep(.009, .006, r));
  c *= 1. - .5*smoothstep(.0, .02, abs(r - .405) - .0)*step(.405, r)*step(r, .43);
  // o braço
  vec2 piv = vec2(.42, .34);
  float prog = fract(T/180.);
  float ra = .38 - .2*prog;
  float tip = -2.5 - .35*prog;
  vec2 st = cc + vec2(cos(tip), sin(tip))*ra;
  st = cc + normalize(vec2(.05,-.32))*ra;
  vec2 mid = mix(piv, st, .7) + vec2(.04,.02);
  float arm = min(sdSeg(p, piv, mid), sdSeg(p, mid, st)) - .009;
  vec2 hd = normalize(st - mid);
  float head = sdBox(rot(-atan(hd.y,hd.x))*(p - st - hd*.01), vec2(.035,.018));
  float cw = length(p - (piv + normalize(piv - mid)*.09)) - .035;
  float base = length(p - piv) - .055;
  float sh = min(min(arm, head), min(cw, base));
  c *= .5 + .5*smoothstep(-.01, .03, min(sdSeg(p - vec2(.015,-.015), piv, mid), sdSeg(p - vec2(.015,-.015), mid, st)) - .009);
  vec3 metal = vec3(.55,.56,.6)*(.6 + .4*smoothstep(-.01,.01,p.x - p.y*.5 - .2));
  c = mix(c, metal, smoothstep(.002, 0., sh));
  c = mix(c, vec3(.08), smoothstep(.002, 0., base + .03));
  // o botão e o fader do tom
  float btn = sdBox(p - vec2(-.68, -.34), vec2(.05,.035));
  c = mix(c, vec3(.12), smoothstep(.002,0.,btn));
  c += vec3(1.,.1,.05)*glow(length(p - vec2(-.68,-.34)), .006)*(.4 + kick());
  float trk = sdBox(p - vec2(.62, -.12), vec2(.008,.2));
  c = mix(c, vec3(.0), smoothstep(.002,0.,trk));
  float fd = sdBox(p - vec2(.62, -.12 + .12*sin(T*.1) + .02*BASS), vec2(.04,.016));
  c = mix(c, vec3(.6), smoothstep(.002,0.,fd));
  c += nc(.6)*glow(length(p - vec2(.62,.14)), .008)*(.3 + .7*BEAT);
  // a luz que bate no centro
  c += nc(.5)*.12*exp(-r*5.)*kick()*SEC;
  c += vec3(1.)*.08*DROP*exp(-r*2.);
  c = aces(c*1.35);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, s, dt, t) => {
  // 33 1/3 rpm; na queda, riscar para trás e para a frente
  const scratch = s.drop > 0.15 ? Math.sin(t * 13) * 9 * s.drop : 0;
  x[6] -= dt * ((33.333 / 60) * Math.PI * 2 * (1 + 0.04 * s.bass) + scratch);
});
