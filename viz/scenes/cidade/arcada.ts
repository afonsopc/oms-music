/**
 * Arcada: um corredor de máquinas de jogos às escuras, cada ecrã com o seu
 * jogo inventado (invasores, ténis, corridas, a capa em píxeis), os
 * letreiros com luzinhas a correr na batida e a alcatifa fluorescente.
 * Na queda todos os ecrãs mostram a capa ao mesmo tempo.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "arcada",
  name: "Arcada",
  names: { en: "Arcade" },
  families: ["electronic", "retro"],
  tags: ["jogos", "arcada", "néon", "anos-80", "capa"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "cover", "palette"],
  lyrics: "glitch",
}, CITY + `
vec3 game(vec2 s, float id){
  // s: 0..1 no ecrã
  float kind = floor(hash(vec2(id, 4.))*4.);
  if(DROP > .35) kind = 0.;
  vec2 px = floor(s*vec2(40., 30.))/vec2(40., 30.);
  vec3 c = vec3(.01,.01,.03);
  if(kind < .5){
    c = cov(px)*1.1;
  } else if(kind < 1.5){
    // invasores a marchar na batida
    vec2 g = s*vec2(8., 10.) - vec2(mod(BEATN, 4.)*.3 - .4, 0.);
    vec2 gi = floor(g), gf = fract(g);
    vec2 pp = floor(gf*vec2(5., 4.));
    float sprite = step(.45, hash(vec2(abs(pp.x - 2.), pp.y + id*3.)));
    float alive = step(gi.y, 8.)*step(4., gi.y)*step(1., gi.x)*step(gi.x, 6.);
    c += nc(gi.y*.15 + id)*sprite*alive*(.7 + .3*kick());
    float ship = step(abs(s.x - .5 - .3*sin(T*1.3 + id)), .04)*step(s.y, .1)*step(.05, s.y);
    c += vec3(.6,1.,.6)*ship;
    c += vec3(1.)*step(abs(s.x - .5 - .3*sin(T*1.3 + id)), .006)*step(fract(T*2. + id), s.y)*step(s.y, fract(T*2. + id) + .08);
  } else if(kind < 2.5){
    // ténis
    float bx = abs(fract(T*.4 + id) - .5)*2., by = abs(fract(T*.53 + id*.3) - .5)*2.;
    c += vec3(1.)*step(length((s - vec2(.1 + .8*bx, .1 + .8*by))*vec2(1.3,1.)), .03);
    c += vec3(1.)*step(abs(s.x - .05), .015)*step(abs(s.y - .1 - .8*by), .1);
    c += vec3(1.)*step(abs(s.x - .95), .015)*step(abs(s.y - .1 - .8*by + .05*sin(T*3.)), .1);
    c += vec3(.5)*step(abs(s.x - .5), .006)*step(.5, fract(s.y*12.));
  } else {
    // corrida: a estrada a vir para nós
    float z = .4/max(.6 - s.y, .02);
    float road = step(abs(s.x - .5), .45/z*1.2);
    c = mix(vec3(.05,.0,.12), nc(.6)*.6, smoothstep(.6, 1., s.y));
    if(s.y < .6){
      c = mix(vec3(.0,.25,.05), vec3(.15), road);
      c += vec3(1.)*road*step(abs(s.x - .5), .02/z)*step(.5, fract(z*2. - T*4.));
      c = mix(c, mix(vec3(.3,.0,.0), vec3(.9,.0,.1), step(.5, fract(z*2. - T*4.))), step(.45/z*1.2, abs(s.x - .5))*step(abs(s.x - .5), .52/z*1.2));
    }
    c += vec3(1.,.2,.2)*step(abs(s.x - .5 - .05*sin(T*2.)), .06)*step(abs(s.y - .1), .04);
  }
  // linhas de varrimento e o vidro curvo
  c *= .75 + .25*sin(s.y*R.y*.9);
  c *= 1. - .6*pow(length(s - .5)*1.3, 3.);
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 rd = vec3(p.x, p.y + .05, 1.);
  float camZ = TRAVEL*.6;
  float W = 1.5, FL = -1., CE = 1.3;
  float tw = rd.x > 0. ? W/rd.x : -W/rd.x;
  float tf = rd.y < 0. ? FL/rd.y : 1e5;
  float tc = rd.y > 0. ? CE/rd.y : 1e5;
  float t = min(tw, min(tf, tc));
  vec3 h = rd*t + vec3(0., 0., camZ);
  vec3 c = vec3(0.);
  float slot = 1.3;
  if(t == tw){
    // a parede das máquinas
    float side = sign(rd.x);
    float zi = floor(h.z/slot), zf = fract(h.z/slot);
    float id = zi*2. + (side > 0. ? 1. : 0.);
    vec2 s = vec2(side > 0. ? zf : 1. - zf, h.y);
    c = vec3(.015,.012,.02);
    float body = step(.08, s.x)*step(s.x, .92)*step(s.y, .95);
    c = mix(c, vec3(.03,.025,.04)*(1. + .5*nc(hash(vec2(id, 1.)))), body);
    vec2 sc = vec2((s.x - .2)/.6, (s.y + .05)/.6);
    if(sc.x > 0. && sc.x < 1. && sc.y > 0. && sc.y < 1.) c = game(sc, id)*(1.6 + .6*kick()*SEC);
    // letreiro com luzinhas
    if(s.y > .68 && s.y < .88 && s.x > .12 && s.x < .88){
      vec3 mc = nc(hash(vec2(id, 2.)));
      c = mc*(.5 + .3*sin(s.x*20.));
      float bulb = smoothstep(.4, .2, length(vec2(fract(s.x*30.) - .5, (s.y - .69)*30.*.0)));
      float chase = step(.5, fract((floor(s.x*30.) + BEATN)/3.));
      c += vec3(1.,.9,.6)*step(abs(s.y - .69), .008)*chase*1.5;
      c += vec3(1.,.9,.6)*step(abs(s.y - .87), .008)*(1. - chase)*1.5;
    }
    // botões e manípulo
    vec2 bq = vec2(s.x, s.y + .15);
    for(int b=0;b<3;b++){ float bb = length(bq - vec2(.55 + float(b)*.1, 0.)); c = mix(c, nc(float(b)*.3)*(.6 + .8*step(.5, hash(vec2(id + float(b), BEATN)))), step(bb, .025)); }
    c = mix(c, vec3(.8,.1,.1), step(length(bq - vec2(.32, .05)), .03));
  } else if(t == tf){
    // alcatifa fluorescente
    vec2 g = h.xz*2.5;
    vec2 gi = floor(g), gf = fract(g) - .5;
    float k = hash(gi);
    float shape = k < .33 ? abs(length(gf) - .25) : k < .66 ? abs(sdBox(rot(k*6.)*gf, vec2(.18, .03))) : abs(gf.y - .12*sin(gf.x*12. + k*9.));
    vec3 carpet = vec3(.01,.008,.03) + nc(k*3.)*smoothstep(.05, .0, shape)*.5*(.7 + .3*kick());
    // a luz dos ecrãs no chão
    float near = exp(-(W - abs(h.x))*2.);
    carpet += nc(hash(vec2(floor(h.z/slot)*2. + step(0., h.x), 1.)))*.12*near;
    c = carpet;
  } else {
    c = vec3(.01,.01,.015);
    c += nc(.5)*glow(abs(h.x), .03)*(.6 + .6*kick());
  }
  c *= exp(-t*.09);
  c += vec3(1.)*.15*DROP*exp(-t*.3);
  c = aces(c*1.4);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, undefined, 0.8);
