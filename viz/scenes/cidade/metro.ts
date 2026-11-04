/**
 * Metro: no cais, do outro lado da linha, uma parede de azulejos nas cores
 * da capa com um cartaz da música. De vez em quando passa uma composição a
 * toda a velocidade, janelas acesas, gente lá dentro; nas quedas passam umas
 * atrás das outras e as luzes do tecto piscam.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "metro",
  name: "Metro",
  names: { en: "Metro" },
  families: ["electronic"],
  tags: ["cidade", "metro", "azulejos", "velocidade", "capa"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "cover", "palette"],
  lyrics: "extrude",
}, CITY + `
vec3 wall(vec2 p){
  // azulejos: um motivo de quatro cantos, nas cores da capa
  vec2 g = p/.075; vec2 id = floor(g), f = fract(g) - .5;
  vec2 m = abs(f);
  float d = min(abs(length(f) - .32), abs(length(m - .5) - .22));
  d = min(d, abs(m.x - m.y)*.7 + .02);
  float ink = smoothstep(.05, .02, d);
  vec3 glaze = vec3(.82,.84,.86)*(.9 + .1*hash(id));
  vec3 blue = mix(C2, vec3(.1,.2,.6), .3)*.8;
  vec3 c = mix(glaze, blue, ink*.85);
  c *= .9 + .1*smoothstep(.5, .44, max(m.x, m.y));
  c *= smoothstep(.5, .47, max(m.x, m.y))*.7 + .3;
  // a faixa com o nome da estação (blocos abstractos)
  if(abs(p.y - .25) < .045){
    c = vec3(.06,.07,.1);
    vec2 lq = vec2(p.x*22., (p.y - .25)/.03);
    float on = step(.4, hash(vec2(floor(lq.x), floor(lq.y*2.)))) * step(abs(lq.y), .9) * step(abs(p.x), .5);
    c += vec3(.9)*on*step(.18, fract(lq.x));
  }
  // o cartaz com a capa
  vec2 pq = p - vec2(-.55, .0);
  float pd = sdBox(pq, vec2(.16,.16));
  if(pd < 0.) c = cov(pq/.32 + .5)*1.05;
  c = mix(c, vec3(.1), smoothstep(.012, .0, abs(pd))*step(pd, .012));
  vec2 pq2 = p - vec2(.6, .0);
  float pd2 = sdBox(pq2, vec2(.16,.16));
  if(pd2 < 0.) c = cov(pq2/.32 + .5)*1.05;
  c = mix(c, vec3(.1), smoothstep(.012, .0, abs(pd2))*step(pd2, .012));
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float shake = (hash(vec2(floor(T*40.), 1.)) - .5)*.006*X[8]*(1. + B);
  p.y += shake;
  float flick = 1. - .5*step(.94, hash(vec2(floor(T*20.), 2.)))*X[8];
  float lights = (.75 + .25*kick())*flick*(1. - .5*step(.5, ON*step(2.5, SECK)));
  vec3 c = vec3(0.);
  // a parede do outro lado
  if(p.y > -.32 && p.y < .38) c = wall(p)*(.55 + .25*lights);
  // tecto e as calhas de luz
  if(p.y >= .38){
    c = vec3(.04,.04,.05);
    float strip = smoothstep(.012, .0, abs(p.y - .44))*step(.15, fract(p.x*2.2));
    c += vec3(.95,.97,1.)*strip*lights*1.5;
  }
  c += vec3(.9,.95,1.)*.06*exp(-abs(p.y - .44)*12.)*lights;
  // a linha
  if(p.y <= -.32){
    c = vec3(.025,.022,.02);
    float rail = smoothstep(.006, .0, abs(p.y + .4)) + smoothstep(.006, .0, abs(p.y + .45));
    c += vec3(.4,.38,.35)*rail*(.5 + .5*lights);
  }
  // o comboio: X[6] frente, X[7] velocidade, X[8] passa (0..1)
  float lx = p.x - X[6];
  float L = 7.;
  if(X[8] > .01 && lx > 0. && lx < L && p.y > -.36 && p.y < .3){
    float v = X[7];
    float bw = .002 + v*.006;
    float carL = 1.4;
    float cx = mod(lx, carL);
    float gap = smoothstep(.0, bw + .01, cx)*smoothstep(carL, carL - bw - .01, cx);
    vec3 body = vec3(.62,.64,.68)*(.7 + .3*smoothstep(-.36, .3, p.y));
    body = mix(body, nc(.0)*.9, smoothstep(.01, .0, abs(p.y + .2) - .03));
    body = mix(body, nc(.4)*.9, smoothstep(.005, .0, abs(p.y + .14) - .008));
    // janelas a deslizar, com gente
    float wx = mod(cx, .28) - .14;
    float win = smoothstep(.06 + bw, .06, abs(wx))*smoothstep(.07, .065, abs(p.y - .08));
    win *= step(.12, cx)*step(cx, carL - .12);
    vec3 inside = vec3(1.,.95,.85)*.9;
    float wid = floor(lx/.28);
    float pers = smoothstep(.02 + bw, .0, length(vec2(wx*.6 + (hash(vec2(wid,1.)) - .5)*.05, p.y - .07 - .03*hash(vec2(wid,2.)))) - .025);
    inside *= 1. - .85*pers*step(.4, hash(vec2(wid,3.)));
    inside = mix(wall(p)*.4, inside, .8);
    vec3 tc = mix(body, inside, win)*gap;
    // portas
    float door = smoothstep(bw + .004, .0, abs(abs(cx - carL*.5) - .1))*step(abs(p.y + .02), .25);
    tc *= 1. - .6*door;
    tc *= .55 + .45*lights;
    // faróis à frente
    tc += vec3(1.,.95,.8)*glow(length(vec2(lx*.4, p.y + .22)), .02)*3.;
    float edge = smoothstep(0., .015, lx)*smoothstep(L, L - .02, lx);
    c = mix(c, tc, edge*X[8]);
  }
  // o vento do túnel ilumina a parede quando passa
  c += vec3(1.,.95,.85)*.1*X[8]*step(-.32, p.y)*(.5 + .5*sin(p.x*20. + T*80.));
  // o cais, à frente, com a faixa amarela
  if(p.y < -.46){
    c = vec3(.08,.08,.085)*(.8 + .2*noise(p*90.));
    float yl = smoothstep(.004, .0, abs(p.y + .48) - .012);
    vec2 bp = fract(vec2(p.x*60., p.y*60.)) - .5;
    c = mix(c, vec3(.95,.8,.1)*(.7 + .3*step(.1, length(bp))), yl)*(.6 + .4*lights);
  }
  c += nc(.5)*.1*DROP;
  c *= 1. - .35*length(p*vec2(.7,1.));
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, s, dt) => {
  // X[6] frente do comboio, X[7] velocidade, X[8] está a passar
  const peak = s.drop > 0.2 || s.section === "drop" || s.section === "high";
  if (x[8] < 0.5) {
    // um novo: no compasso certo (de 2 em 2), ou já a seguir se é a queda
    const ph = s.bar % 2;
    if (peak || (ph < 0.05 && s.sectionIntensity > 0.3)) {
      x[6] = 1.4;
      x[7] = peak ? 6 : 3.5 + 2 * s.energy;
      x[8] = 1;
    }
  } else {
    x[6] -= dt * x[7];
    if (x[6] < -9) x[8] = 0;
  }
});
