/**
 * Passadeira: um cruzamento visto de cima, em longa exposição. Rastos dos
 * carros a correr nas faixas que estão abertas, os semáforos a trocar no
 * compasso, gente a atravessar ao passo da batida. As riscas da passadeira
 * são um equalizador; na queda abrem-se todas as direcções ao mesmo tempo.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "passadeira",
  name: "Passadeira",
  names: { en: "Crossing" },
  families: ["electronic"],
  tags: ["cidade", "semáforo", "rua", "noite", "de-cima"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "bar", "drop", "palette"],
  lyrics: "extrude",
}, CITY + `
// rasto ao longo de x (faixa em y = y0), direcção dir, velocidade spd
vec3 lane(vec2 q, float y0, float dir, float spd, vec3 col, float open){
  float d = abs(q.y - y0);
  float s = q.x*dir*3. - TRAVEL*spd;
  float id = floor(s), f = fract(s);
  float on = step(.35, hash(vec2(id, y0*10.)))*smoothstep(0., .1, f)*smoothstep(1., .4, f);
  float w = .006;
  return col*on*open*(glow(d, w) + .15*glow(d, w*5.));
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p = rot(.35 + .03*sin(T*.05))*p;
  p *= 1.25 - .06*kick()*BASS - .1*DROP;
  vec3 c = vec3(.016,.017,.022)*(1. + .5*fbm(p*14.));
  float rw = .24;
  float roadH = step(abs(p.y), rw), roadV = step(abs(p.x), rw);
  float road = max(roadH, roadV);
  // os quarteirões: telhados escuros com máquinas e janelas de clarabóia
  if(road < .5){
    vec2 b = p - sign(p)*rw;
    float side = sdBox(fract(p*3.) - .5, vec2(.44));
    vec3 roof = vec3(.03,.03,.04)*(1. + .4*hash(floor(p*3.)));
    roof += step(.75, hash(floor(p*24.)))*vec3(.06);
    roof += step(.93, hash(floor(p*40.)))*mix(vec3(1.,.75,.4), nc(hash(floor(p*40.))), .3)*.6;
    c = mix(vec3(.05,.05,.06), roof, step(side, -.03));
  }
  // as faixas: quem tem verde. Troca de 2 em 2 compassos; na queda todos
  float ph = mod(floor(BAR/2.), 2.);
  float tr = fract(BAR/2.);
  float amber = step(.85, tr);
  float hOpen = clamp((ph < .5 ? 1. : 0.) + DROP*1.5, 0., 1.);
  float vOpen = clamp((ph < .5 ? 0. : 1.) + DROP*1.5, 0., 1.);
  vec3 red = mix(vec3(1.,.1,.05), nc(.0), DROP);
  vec3 white = mix(vec3(1.,.95,.85), nc(.5), DROP);
  vec3 t = vec3(0.);
  if(roadH > .5){
    t += lane(p, .06, 1., 2., white, hOpen) + lane(p, .15, 1., 1.6, white, hOpen);
    t += lane(p, -.06, -1., 2., red, hOpen) + lane(p, -.15, -1., 1.6, red, hOpen);
  }
  if(roadV > .5){
    vec2 q = p.yx;
    t += lane(q, .06, 1., 2., white, vOpen) + lane(q, .15, 1., 1.6, white, vOpen);
    t += lane(q, -.06, -1., 2., red, vOpen) + lane(q, -.15, -1., 1.6, red, vOpen);
  }
  // linha do meio
  c += vec3(.4,.35,.1)*smoothstep(.004, .0, abs(p.y))*roadH*(1. - roadV)*step(.5, fract(p.x*8.));
  c += vec3(.4,.35,.1)*smoothstep(.004, .0, abs(p.x))*roadV*(1. - roadH)*step(.5, fract(p.y*8.));
  // as passadeiras: cada risca é uma barra do equalizador
  for(int k=0;k<4;k++){
    vec2 q = k==0 ? p : k==1 ? vec2(-p.x, -p.y) : k==2 ? vec2(p.y, -p.x) : vec2(-p.y, p.x);
    // a passadeira atravessa a estrada horizontal, à direita do cruzamento
    vec2 z = q - vec2(rw + .1, 0.);
    if(abs(z.x) < .06 && abs(z.y) < rw){
      float i = floor((z.y + rw)/(rw*2.)*9.);
      float f = fract((z.y + rw)/(rw*2.)*9.);
      float band = i < 2. ? B : i < 4. ? LM : i < 7. ? M : H;
      float lvl = clamp(band*1.2 + .1*sin(i*1.7 + T*3.), 0., 1.);
      float fill = step(abs(z.x)/.06, lvl);
      float stripe = smoothstep(.15, .2, f)*smoothstep(.85, .8, f);
      vec3 sc = mix(vec3(.55), nc(i/9. + float(k)*.25), .6);
      c = mix(c, vec3(.12), stripe*.8);
      c += sc*stripe*fill*(.8 + .6*kick());
      // gente a atravessar, um passo por batida
      float walker = 0.;
      for(int j=0;j<3;j++){
        float fj = float(j);
        float open = k < 2 ? vOpen : hOpen;
        float pos = fract((BEATN + smoothstep(0., .4, BPH))/16. + hash(vec2(fj, float(k)))) * 2. - 1.;
        vec2 wp = vec2((fj - 1.)*.03, pos*rw);
        walker += glow(length(z - wp), .006)*(1. - open);
      }
      c += vec3(1.)*walker*1.5;
    }
  }
  c += t*1.2;
  // semáforos nos quatro cantos, com auréola no asfalto molhado
  for(int k=0;k<4;k++){
    float a = float(k)*PI*.5 + PI*.25;
    vec2 sp = vec2(cos(a), sin(a))*(rw + .05)*1.414;
    bool horiz = k == 0 || k == 2;
    float go = horiz ? hOpen : vOpen;
    vec3 lc = amber > .5 ? vec3(1.,.6,.05) : go > .5 ? vec3(.1,1.,.5) : vec3(1.,.08,.05);
    float r = length(p - sp);
    c += lc*(glow(r, .012)*1.3 + glow(r, .08)*.15)*(.7 + .5*kick());
  }
  c += nc(.2)*.18*DROP*exp(-length(p)*2.);
  c = aces(c*1.2);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
