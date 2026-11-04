/**
 * Vulcão: um cone negro à noite com a cratera em brasa e rios de lava pelas
 * encostas. A cratera respira com os graves e cospe faúlhas na batida; a
 * coluna de fumo sobe iluminada por baixo. Nas quedas o vulcão entra em
 * erupção: uma fonte de lava, bombas incandescentes em arco e o céu todo a
 * arder nas cores da capa.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "vulcao",
  name: "Vulcão",
  names: { en: "Volcano", lv: "Vulkāns" },
  families: ["electronic", "chaos"],
  tags: ["natureza", "fogo", "quente", "escuro", "noite"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, NAT_GLSL + `
vec3 fire(float k){
  vec3 a = mix(vivid(C1), vec3(.7,.1,.02), .45), b = mix(vivid(C2), vec3(1.,.6,.15), .4);
  return mix(mix(vec3(0.), a, smoothstep(0., .4, k)), mix(b, vec3(1.4,1.25,1.), smoothstep(.8, 1.2, k)), smoothstep(.35, .8, k));
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float erupt = U[0].x, et = U[0].y, clock = U[0].z, puff = U[0].w;
  float crater = U[1].x;
  vec2 top = vec2(0., -.02);
  // céu
  vec3 col = mix(vivid(C3)*.05, vec3(.0,.0,.01), smoothstep(-.3, .5, p.y));
  col += fire(.5)*.25*exp(-length(p - top)*2.5)*(.4 + crater + erupt*1.5);
  vec2 sp = floor(p*200.);
  col += step(.997, hash(sp))*smoothstep(.1, .45, p.y)*.5;
  // coluna de fumo
  float sy = p.y - top.y;
  if(sy > -.02){
    float wdt = .05 + sy*.55 + .05*erupt;
    vec2 q = vec2(p.x/wdt, sy*2. - clock*.35);
    float n = fbm(q*vec2(1.2, 1.) + vec2(0., -clock*.1)) ;
    float n2 = fbm(q*2.3 + n*1.5 + vec2(clock*.05, 0.));
    float plume = smoothstep(1.1, .3, abs(p.x)/wdt + (1. - n2)*.6)*smoothstep(-.02, .06, sy)*smoothstep(.9, .3, sy - .3*erupt);
    vec3 sm = vivid(C3)*.05 + vec3(.02);
    sm += fire(.6)*exp(-sy*(5. - 2.5*erupt))*(.5 + crater + 2.*erupt)*n2;
    col = mix(col, sm, plume*.9);
  }
  // o cone
  float slope = .9 + .05*sin(p.x*9.);
  float h = top.y - abs(p.x)*slope*.62 - .015*fbm(vec2(p.x*12., 0.));
  h = min(h, top.y - .005 + .012*abs(sin(p.x*60.)));
  float ground = -.42 + .03*fbm(vec2(p.x*3., 2.));
  if(p.y < max(h, ground)){
    vec3 rock = vivid(C3)*.025 + vec3(.012,.01,.01);
    float depth = max(h, ground) - p.y;
    float n = fbm(p*vec2(30., 14.));
    rock *= .7 + .6*n;
    // rios de lava a descer das bordas
    float x = p.x + .03*sin(p.y*30.)*.6;
    float rivers = 0.;
    for(int i=0;i<4;i++){
      float fi = float(i);
      float cx = (fi - 1.5)*.06*(1. + (top.y - p.y)*2.5);
      cx += .04*sin(p.y*15. + fi*2.);
      float wv = .006 + .004*sin(p.y*40. + fi);
      float on = step(p.y, top.y) * smoothstep(-.4 + .25*hash1(fi), top.y - .02, p.y + .2*(erupt + crater*.3));
      rivers += smoothstep(wv, 0., abs(x - cx))*on;
    }
    float flow = .6 + .4*noise(vec2(p.x*40., p.y*20. + clock*2.));
    col = rock + fire(.55 + .4*flow)*rivers*(.6 + crater*.6 + erupt);
    col += fire(.5)*exp(-length(p - top)*14.)*(crater + erupt)*.8;
    col += fire(.3)*smoothstep(.05, 0., depth)*.06*(1. + erupt);
  }
  // a boca
  float mouth = smoothstep(.04, .0, length((p - top)*vec2(1., 5.)));
  col += fire(.8 + .3*crater)*mouth*(.6 + crater + erupt);
  // fonte de lava e bombas
  if(erupt > .01){
    float fh = .25*erupt*(.8 + .2*sin(clock*20.));
    float fx = abs(p.x - .01*sin(p.y*40. + clock*30.));
    float fount = smoothstep(.02 + .03*(p.y - top.y), 0., fx)*step(top.y, p.y)*smoothstep(top.y + fh, top.y, p.y);
    col += fire(.95)*fount*1.5;
  }
  for(int i=0;i<40;i++){
    float fi = float(i);
    float born = U[2].x + floor(fi/10.)*.25;
    float a = et - born + hash1(fi*3.1)*.2;
    if(a < 0. || a > 3.) continue;
    float ang = (hash1(fi) - .5)*1.6;
    float v = .4 + .5*hash1(fi*7.7);
    vec2 bp = top + vec2(sin(ang), cos(ang))*v*a + vec2(0., -.35*a*a);
    float d = length(p - bp);
    float life = 1. - a/3.;
    col += fire(.7 + .4*life)*(smoothstep(.006, .0, d)*1.6 + .02/(d*60. + .2)*.3)*life*step(.001, U[2].y);
  }
  // faúlhas da batida
  for(int i=0;i<16;i++){
    float fi = float(i);
    float a = clock - puff - hash1(fi)*.1;
    if(a < 0. || a > 1.2) continue;
    vec2 bp = top + vec2((hash1(fi*5.) - .5)*.25*a, (.15 + .25*hash1(fi*9.))*a - .1*a*a);
    col += fire(.8)*smoothstep(.004, .0, length(p - bp))*(1. - a/1.2);
  }
  col += fire(.6)*DROP*.15;
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const erupt = new Envelope(0.15, 3.5);
    const crater = new Envelope(0.02, 0.4);
    let clock = 10, et = 100, puff = -10, burst = -10, has = 0;
    return (u, _t, s, dt) => {
      clock += dt;
      et += dt;
      if (sec.hit(s) && sec.big) { erupt.kick(1); burst = et; has = 1; }
      if (beat.hit(s)) { crater.kick(0.3 + 0.7 * s.bass); if (s.sectionIntensity > 0.4) puff = clock; }
      erupt.step(s.section === "drop" || s.section === "high" ? 0.45 : 0, dt);
      crater.step(0.15 + 0.3 * s.bass, dt);
      u[0] = erupt.v; u[1] = et; u[2] = clock; u[3] = puff; u[4] = crater.v;
      u[8] = burst; u[9] = has;
    };
  },
});
