/**
 * Drone sobre Lisboa: um voo nocturno de cima, sobre colinas de telhados
 * de telha, ruas tortas com candeeiros e o rio largo ao lado. Cada batida
 * é uma onda de luz que corre pelas ruas; na queda a cidade acende-se nas
 * cores da capa. Por cima, o ecrã do comando do drone.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "drone",
  name: "Drone sobre Lisboa",
  names: { en: "Drone over Lisbon" },
  families: ["electronic"],
  tags: ["lisboa", "cidade", "de-cima", "voo", "rio", "noite"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, CITY + `
float hill(vec2 w){ return fbm(w*.35); }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float alt = 1.7 - .25*BASS - .6*DROP + .3*sin(T*.07);
  vec2 w = rot(.25*sin(T*.03) + .4)*p*alt + vec2(T*.03, TRAVEL*.35);
  // o rio
  float shore = w.x + .6*sin(w.y*.23) + .3*sin(w.y*.61 + 1.) - 2.2;
  float h = hill(w);
  vec2 e = vec2(.04, 0.);
  vec3 c;
  float wave = 0.;
  float rr = length(p);
  for(int i=0;i<2;i++){
    float age = BPH + float(i);
    wave += exp(-abs(rr - age*.7)*9.)*exp(-age*1.6);
  }
  wave *= .4 + .8*SEC;
  if(shore > 0.){
    // água escura com brilhos e barcos
    float gl = noise(w*vec2(8.,1.5) + vec2(0., T*.4));
    c = vec3(.01,.015,.03) + C2*.04;
    c += vec3(.6,.65,.8)*pow(gl, 10.)*.5*smoothstep(3., 0., shore);
    c += mix(vec3(1.,.6,.3), nc(.3), .3)*.12*exp(-shore*3.);
    vec2 bq = w*vec2(.6,.4) + vec2(0., T*.05);
    float boat = step(.985, hash(floor(bq)))*glow(length(fract(bq) - .5), .03);
    c += vec3(1.,.9,.7)*boat;
  } else {
    // colinas: sombra pela inclinação
    float hx = hill(w + e.xy) - h, hy = hill(w + e.yx) - h;
    float shade = clamp(.6 + (hx - hy)*14., .2, 1.2);
    // quarteirões irregulares: uma grelha torcida
    vec2 g = w*2.2 + .6*vec2(noise(w*.5), noise(w*.5 + 7.));
    vec2 id = floor(g), f = fract(g);
    float street = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
    float lot = smoothstep(.035, .05, street);
    // telhados de telha (em casinhas dentro do quarteirão)
    vec2 hq = f*vec2(3. + floor(hash(id)*3.), 2.);
    vec2 hid = floor(hq), hf = fract(hq);
    float hh = hash(id*7. + hid);
    vec3 tile = mix(vec3(.55,.22,.12), vec3(.75,.42,.25), hh);
    tile = mix(tile, vec3(.8,.78,.72), step(.85, hh));
    float ridge = abs(hf.y - .5);
    tile *= .55 + .45*smoothstep(.0, .5, ridge)*(hf.y > .5 ? 1. : .6);
    tile *= smoothstep(.0, .05, min(min(hf.x, 1. - hf.x), min(hf.y, 1. - hf.y)))*.5 + .5;
    // é de noite: os telhados vêem-se pouco, iluminados pela cidade
    vec3 roof = tile*.32*shade*(.8 + .4*noise(w*3.));
    vec2 wn = w*46.; roof += mix(vec3(1.,.7,.4), nc(hh), .25)*step(.95, hash(floor(wn)))*smoothstep(.5,.3,max(abs(fract(wn.x)-.5),abs(fract(wn.y)-.5)))*.55;
    vec3 rd = vec3(.02,.018,.02);
    // candeeiros nas ruas
    vec2 lq = g*4.;
    vec2 lf = fract(lq) - .5;
    float lamp = glow(length(lf), .05)*step(street, .05)*step(.4, hash(floor(lq)));
    vec3 lc = mix(vec3(1.,.6,.25), nc(hash(floor(lq)) + BAR*.05), clamp(DROP*1.5 + step(2.5, SECK)*.4, 0., 1.));
    c = mix(rd + lc*.05*smoothstep(.05, 0., street), roof, lot);
    c += lc*lamp*(1. + 3.*wave);
    // a costa iluminada
    c += mix(vec3(1.,.6,.3), nc(.6), .4)*.3*smoothstep(-.12, 0., shore);
  }
  // o ecrã do comando
  vec2 a = abs(p);
  float hud = smoothstep(.002, .0, abs(max(a.x - .62, a.y - .38)))*step(.1, min(abs(a.x - .62), abs(a.y - .38)) - .0);
  float corner = step(max(abs(a.x - .62), abs(a.y - .38)), .0018)*step(.55, max(a.x/.62, a.y/.38))*step(min(abs(a.x - .62), abs(a.y - .38)), .002);
  float cross = smoothstep(.0015, .0, min(abs(p.x), abs(p.y)))*step(length(p), .035)*step(.012, length(p));
  float tick = smoothstep(.0015, .0, abs(p.x + .66))*step(.5, fract(p.y*25. + TRAVEL*2.))*step(abs(p.y), .3);
  c += vec3(.85)*(cross + tick*.5)*.6;
  vec2 rp = p - vec2(-.6, .34);
  c += vec3(1.,.1,.05)*smoothstep(.012, .008, length(rp))*step(.5, fract(BEATN*.5));
  c *= 1. - .4*length(p*vec2(.6,1.));
  c += nc(.1)*.08*DROP;
  c = aces(c*1.6);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
