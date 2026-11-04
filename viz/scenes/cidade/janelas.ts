/**
 * Janelas: uma frente de prédios à noite. As janelas acendem e apagam na
 * batida, uma onda sobe pelo prédio em cada compasso, as luzes vermelhas do
 * topo piscam; nos refrões e nas quedas a cidade inteira vira um mosaico da
 * capa, uma janela por píxel.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "janelas",
  name: "Janelas",
  names: { en: "Windows" },
  families: ["electronic"],
  tags: ["cidade", "noite", "prédios", "capa", "mosaico"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "cover", "palette"],
  artwork: "own",
  lyrics: "neon",
}, CITY + `
// m: quanto a cidade é a capa (0..1)
vec4 block(vec2 p, float sc, float seed, float off, float m, float dim){
  vec2 q = vec2(p.x*sc + off, (p.y + .5)*sc);
  float bx = floor(q.x), fx = fract(q.x);
  float hb = mix(.35 + 1.05*hash(vec2(bx, seed)), 1.75, m*.8)*sc*.55 + .15*sc*step(.85, hash(vec2(bx, seed+9.)));
  float ins = .04 + .14*hash(vec2(bx, seed+1.));
  if(fx < ins || fx > 1. - ins || q.y > hb) return vec4(0.);
  vec3 wall = vec3(.025,.022,.035)*(1. + .5*hash(vec2(bx,seed+4.)));
  // a grelha das janelas
  float cols = floor(9. + 9.*hash(vec2(bx, seed+2.)));
  float cw = (1. - 2.*ins)/cols;
  vec2 g = vec2((fx - ins)/cw, q.y/(cw*1.35));
  vec2 id = floor(g), f = fract(g);
  float inWin = step(.2,f.x)*step(f.x,.8)*step(.22,f.y)*step(f.y,.82);
  float top = floor(hb/(cw*1.35));
  if(id.y >= top - .5) inWin = 0.;
  vec2 wid = id + vec2(bx*31., seed*7.);
  float h0 = hash(wid);
  float level = .18 + .55*ENER + .25*SEC;
  float lit = step(h0, level);
  // algumas mudam a cada batida
  float flip = step(.82, hash(wid + vec2(BEATN*.37, 3.)));
  lit = abs(lit - flip*step(.5, hash(wid+5.)));
  // a onda que sobe em cada compasso
  float wave = smoothstep(.12, 0., abs(id.y/max(top,1.) - fract(BAR)))*step(.5, hash(vec2(bx, floor(BAR))));
  float kind = hash(wid + 11.);
  vec3 warm = mix(vec3(1.,.72,.38), vec3(1.,.85,.6), hash(wid+2.));
  vec3 tv = vec3(.35,.55,1.)*(.6 + .4*sin(T*9. + h0*40.)*noise(vec2(T*4., h0*9.)));
  vec3 neon = nc(h0*3. + BAR*.05);
  vec3 wc = kind < .7 ? warm : kind < .87 ? tv : neon;
  wc *= .55 + .45*f.y; // cortina: mais claro em cima
  float on = clamp(lit + wave + BEAT*step(.93, h0), 0., 1.);
  // o mosaico: cada janela é um píxel da capa
  vec2 sp = vec2(((bx + ins + (id.x + .5)*cw) - off)/sc, (id.y + .5)*cw*1.35/sc - .5);
  vec2 cu = sp/vec2(.95) + .5;
  vec3 art = cov(cu)*1.25*(.85 + .15*kick());
  float inside = step(0., cu.x)*step(cu.x, 1.)*step(0., cu.y)*step(cu.y, 1.);
  wc = mix(wc*on, art, m*inside);
  wc = mix(wc, wc*on*.6 + neon*.05, m*(1. - inside));
  vec3 c = wall + inWin*wc*dim;
  // a luz vermelha no topo
  vec2 lp = vec2((fx - .5)/sc*sc, q.y - hb);
  c += vec3(1.,.08,.05)*glow(length(vec2((fx - .5), (q.y - hb - .03*sc)/sc*3.)), .02)*step(.5, hash(vec2(bx,seed+6.)))*(.3 + 1.2*kick())*dim;
  return vec4(c, 1.);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float zoom = 1. - .04*kick()*BASS - .06*DROP;
  p *= zoom;
  float m = clamp(smoothstep(.72, .9, SEC)*step(2.5, SECK) + DROP*1.2, 0., 1.);
  vec3 sky = mix(C1*.22 + vec3(.03,.02,.06), vec3(.005,.004,.015), smoothstep(-.3, .5, p.y));
  sky += nc(.6)*.12*exp(-(p.y + .5)*3.)*(.6 + .4*E);
  vec3 c = sky;
  float pan = TRAVEL*.05;
  vec4 a = block(p, 3.2, 3., pan*.5 + 10., m*.4, .35);
  c = mix(c, a.rgb + sky*.25, a.a);
  vec4 b = block(p, 1.6, 1., pan + 3.3, m, 1.);
  c = mix(c, b.rgb, b.a);
  // névoa de rua no fundo
  c += nc(.1)*.08*exp(-(p.y + .5)*6.)*(1. + 2.*BEAT*.3);
  c += vec3(1.)*.12*DROP;
  c = aces(c*1.2);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
