/**
 * Praça dos ecrãs: no meio de uma praça cercada de prédios forrados de
 * ecrãs gigantes, a olhar para cima. Cada ecrã corta para outra coisa na
 * batida (a capa, anúncios abstractos, letreiros a correr); na queda os
 * ecrãs todos mostram a capa ao mesmo tempo, a piscar.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "ecras",
  name: "Praça dos ecrãs",
  names: { en: "Screen square" },
  families: ["electronic", "chaos"],
  tags: ["cidade", "ecrãs", "néon", "noite", "capa"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "beat", "onset", "drop", "section", "cover", "palette"],
  artwork: "own",
  lyrics: "extrude",
}, CITY + `
vec3 content(vec2 s, float id, float asp){
  float pick = hash(vec2(id, floor(BEATN/2.) + floor(hash(vec2(id, 9.))*3.)));
  if(DROP > .3 || pick < .3){
    // a capa, cortada ao meio se o ecrã é comprido
    vec2 q = (s - .5)*vec2(asp, 1.)/max(1., asp*.5) + .5;
    q = asp > 1.6 ? vec2(fract(s.x*asp*.6 - T*.05), s.y) : q;
    return cov(q)*1.05;
  }
  if(pick < .55){
    // anúncio: formas grandes nas cores da capa
    vec2 q = (s - .5)*vec2(asp, 1.);
    float r = length(q - vec2(.2*sin(T + id), 0.));
    vec3 c = mix(nc(id*.37), nc(id*.37 + .3), s.y);
    c = mix(c, vec3(1.), smoothstep(.22, .2, r)*step(.5, hash(vec2(id, 3.))));
    c = mix(c, nc(id*.37 + .6), step(.5, fract((q.x + q.y)*3. + T*.5))*step(.5, hash(vec2(id, 4.))));
    return c*.9;
  }
  if(pick < .8){
    // letreiro a correr: blocos de pontos
    vec2 q = vec2(s.x*asp*10. + T*6., s.y*7.);
    vec2 qi = floor(q);
    float on = step(.45, hash(qi + vec2(0., id)))*step(1., qi.y)*step(qi.y, 5.);
    return mix(vec3(.02), nc(id*.21 + .5)*1.2, on);
  }
  // cor lisa a pulsar
  return nc(id*.13)*(.3 + .9*kick());
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  // a olhar para cima, a rodar devagar
  float yaw = .25*sin(T*.05) + .002*TRAVEL;
  vec3 rd = normalize(vec3(p.x, p.y, .9));
  float pitch = .42 + .05*sin(T*.1) - .04*kick()*BASS;
  rd.yz = rot(pitch)*rd.yz;
  rd.xz = rot(yaw)*rd.xz;
  float W = 4.5;
  vec3 c = mix(vec3(.02,.015,.04), C1*.12, smoothstep(1., .3, rd.y));
  // quatro paredes à volta (uma praça quadrada)
  float tx = (sign(rd.x)*W)/rd.x, tz = (sign(rd.z)*W)/rd.z;
  float t = min(tx, tz);
  vec3 h = rd*t + vec3(0., 1.2, 0.);
  float face = t == tx ? (rd.x > 0. ? 0. : 2.) : (rd.z > 0. ? 1. : 3.);
  float u = t == tx ? -h.z*sign(rd.x) : h.x*sign(rd.z);
  float v = h.y;
  float topV = 7. + 9.*hash(vec2(floor(u/3.), face));
  if(v < topV){
    vec3 wall = vec3(.012,.012,.018);
    // os ecrãs: uma grelha de blocos que se partem em ecrãs mais pequenos
    vec2 g = vec2(u + 30., v)/vec2(1.2, .9);
    vec2 gi = floor(g), gf = fract(g);
    float id = gi.x + gi.y*7. + face*61.;
    float split = hash(vec2(id, 1.));
    vec2 sz = vec2(1.);
    if(split > .55){ sz = vec2(1., .5); gi.y += step(.5, gf.y)*.5; gf.y = fract(gf.y*2.); id += step(.5, fract(g.y)*1.)*.5; }
    else if(split > .3){ sz = vec2(.5, 1.); id += step(.5, gf.x)*.25; gf.x = fract(gf.x*2.); }
    float m = .05;
    vec2 sm = (gf - m)/(1. - 2.*m);
    float asp = (sz.x*1.2)/(sz.y*.9);
    float isScreen = step(.15, hash(vec2(id, 2.)));
    c = wall;
    if(sm.x > 0. && sm.x < 1. && sm.y > 0. && sm.y < 1. && isScreen > .5 && v > .2){
      vec3 sc = content(sm, id, asp);
      // os píxeis de LED, visíveis de perto
      vec2 led = fract(sm*vec2(asp, 1.)*60.);
      sc *= mix(1., .5 + .7*step(.25, led.x)*step(.25, led.y), smoothstep(9., 4., t));
      float cut = step(.85, hash(vec2(id, BEATN)))*kick();
      c = sc*(.85 + .5*cut + .3*ON);
    }
    // janelas acesas onde não há ecrãs
    if(isScreen < .5){
      vec2 wq = fract(vec2(u, v)*vec2(6., 5.));
      c += vec3(1.,.75,.45)*.3*step(.6, hash(floor(vec2(u, v)*vec2(6., 5.))))*step(.3, wq.x)*step(wq.x, .7)*step(.3, wq.y)*step(wq.y, .7);
    }
    // as esquinas dos prédios
    c *= smoothstep(.0, .1, abs(abs(u) - W))*smoothstep(.5, .47, abs(fract(u/3.) - .5));
    c += nc(.3)*.4*smoothstep(.06, .0, abs(v - topV + .03))*(.5 + kick());
    c *= exp(-t*.03);
  }
  // o céu lá em cima
  float top = smoothstep(.9, 1., rd.y);
  c += nc(.6)*.1*top;
  c += vec3(1.)*.12*DROP*kick();
  c = aces(c*1.25);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
