/**
 * Cassete: uma cassete de plástico fumado com a capa na etiqueta, as duas
 * bobinas a rodar (a fita passa de uma para a outra ao longo da música), os
 * parafusos, a fita à vista em baixo. Salta na batida; na queda avança
 * rápido, com o som a "enrolar" nas cores.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "cassete",
  name: "Cassete",
  names: { en: "Cassette" },
  families: ["electronic", "retro"],
  tags: ["cassete", "anos-80", "anos-90", "capa", "fita"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "cover", "palette"],
  artwork: "own",
  lyrics: "ink",
}, CITY + `
float rbox(vec2 p, vec2 b, float r){ return sdBox(p, b - r) - r; }
vec3 reel(vec2 q, float ang, float pack){
  float r = length(q);
  vec3 c = vec3(0.);
  // fita enrolada: castanha com anéis finos
  float tp = smoothstep(pack + .002, pack, r)*step(.034, r);
  vec3 tape = vec3(.16,.09,.05)*(.7 + .3*sin(r*900.))*(.7 + .3*smoothstep(.0, pack, r));
  tape += vec3(.25,.18,.12)*pow(abs(cos(atan(q.y, q.x) - .8)), 20.)*.4;
  c = mix(c, tape, tp);
  // o cubo branco com dentes, a rodar
  vec2 rq = rot(ang)*q;
  float a = atan(rq.y, rq.x);
  float teeth = .026 + .006*step(.5, fract(a/(2.*PI)*6.));
  float hub = step(r, .034)*step(teeth, r);
  float inner = step(r, teeth);
  c = mix(c, vec3(.85,.85,.82), hub);
  c = mix(c, vec3(.02), inner*step(r, .03)*step(.012, r)*0.);
  c = mix(c, vec3(.02), inner);
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float k = kick();
  vec3 bg = mix(vec3(.015,.012,.02), C1*.12, smoothstep(.8, -.4, p.y + p.x*.4));
  bg += nc(.5)*.12*exp(-length(p - vec2(.6, .4))*2.5);
  vec3 c = bg;
  float s = .72 - .02*k*(.4 + BASS) - .02*DROP;
  vec2 q = rot(-.06 + .02*sin(T*.3))*p*s;
  // sombra no tampo
  c *= 1. - .6*smoothstep(.08, -.02, rbox(q - vec2(.02, -.03), vec2(.4, .26), .03));
  float body = rbox(q, vec2(.4, .25), .025);
  float prog = fract(T/150.);
  float pL = mix(.105, .045, prog), pR = mix(.045, .105, prog);
  if(body < 0.){
    vec3 shell = vec3(.06,.06,.07)*(1. + .3*smoothstep(.25, -.25, q.y));
    c = shell;
    // a etiqueta: a capa à esquerda e riscas da música
    vec2 lq = q - vec2(0., .06);
    float lab = rbox(lq, vec2(.36, .15), .01);
    if(lab < 0.){
      vec3 lc = vec3(.92,.9,.85);
      lc = mix(lc, nc(.0), step(abs(lq.y + .095), .012));
      lc = mix(lc, nc(.35), step(abs(lq.y + .07), .006));
      // linhas para escrever à mão
      lc *= 1. - .25*smoothstep(.0015, .0, abs(fract(lq.y*28.) - .5) - .45)*step(lq.y, .13)*step(-.04, lq.y);
      vec2 cq = lq - vec2(-.27, .03);
      if(abs(cq.x) < .085 && abs(cq.y) < .085) lc = cov(cq/.17 + .5);
      c = lc;
    }
    // a janela com as bobinas
    vec2 wq = q - vec2(0., .04);
    float win = rbox(wq, vec2(.17, .05), .02);
    vec2 a = vec2(-.12, .04), b = vec2(.12, .04);
    if(win < 0.){
      vec3 wc = vec3(.03,.03,.04);
      wc += reel(q - a, X[6]*(.07/pL), pL);
      wc += reel(q - b, X[6]*(.07/pR), pR);
      wc += vec3(.15)*smoothstep(.06, .0, abs(wq.y - wq.x*.3 - .03))*.4;
      c = wc;
    }
    // os furos das bobinas por fora da janela
    for(int i=0;i<2;i++){
      vec2 hq = q - (i == 0 ? a : b);
      float hr = length(hq);
      if(win > 0.) c = mix(c, reel(hq, X[6]*(.07/(i == 0 ? pL : pR)), .0), step(hr, .036));
      c = mix(c, vec3(.2), smoothstep(.003, .0, abs(hr - .037)));
    }
    // a parte de baixo: trapézio, furos e a fita à vista
    vec2 tq = q - vec2(0., -.2);
    float trap = max(abs(tq.y) - .05, abs(tq.x) - .25 + tq.y*1.2);
    c = mix(c, vec3(.045,.045,.05), step(trap, 0.));
    c = mix(c, vec3(.0), smoothstep(.002, .0, length(tq - vec2(-.13, .0)) - .016));
    c = mix(c, vec3(.0), smoothstep(.002, .0, length(tq - vec2(.13, .0)) - .016));
    c = mix(c, vec3(.0), smoothstep(.002, .0, sdBox(tq - vec2(0., -.01), vec2(.03, .015))));
    c = mix(c, vec3(.2,.11,.06), step(abs(q.y + .248), .003)*step(abs(q.x), .2));
    // parafusos
    for(int i=0;i<5;i++){
      vec2 sp = i == 0 ? vec2(-.37, .22) : i == 1 ? vec2(.37, .22) : i == 2 ? vec2(-.37, -.22) : i == 3 ? vec2(.37, -.22) : vec2(0., -.17);
      float sr = length(q - sp);
      vec3 sc = vec3(.5)*(.6 + .4*dot(normalize(q - sp + 1e-5), vec2(-.6, .8)));
      sc *= 1. - smoothstep(.002, .0, abs((q - sp).x - (q - sp).y) - .001);
      c = mix(c, sc, smoothstep(.009, .007, sr));
    }
    // brilho do plástico
    c += vec3(.5)*.12*smoothstep(.02, .0, abs(q.x + q.y*.6 - .1 + .05*sin(T*.2)) - .03);
    c += nc(.6)*.06*k;
  }
  c = mix(c, vec3(.18), smoothstep(.003, .0, abs(body))*.5);
  // avançar rápido: as cores escorregam
  c += nc(.2)*.1*DROP*(.5 + .5*sin(p.y*80. + T*50.));
  c = aces(c*1.35);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, s, dt) => {
  // a bobina roda a uma velocidade de leitura; na queda avança rápido
  x[6] -= dt * (2.2 + 22 * s.drop + 0.6 * s.bass);
});
