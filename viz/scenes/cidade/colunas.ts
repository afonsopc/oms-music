/**
 * Parede de colunas: um muro de caixas de som a bombar. Os cones saltam
 * com os graves, o ar treme à frente deles, a parede inteira abana no
 * bombo; na queda a pancada corre pela parede numa onda a partir do
 * centro e as luzes de trás disparam.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "colunas",
  name: "Parede de colunas",
  names: { en: "Speaker wall" },
  families: ["chaos", "electronic"],
  tags: ["som", "graves", "concerto", "clube", "capa"],
  intensity: 5,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "cover", "palette"],
  lyrics: "glitch",
}, CITY + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float k = kick();
  p.y += (hash(vec2(floor(T*50.), 3.)) - .5)*.008*k*B;
  p.x += (hash(vec2(floor(T*50.), 4.)) - .5)*.005*k*B;
  // a parede vista um pouco de baixo
  vec2 q = p/(1. - p.y*.18);
  q *= .92 - .03*DROP;
  vec2 cell = vec2(.3, .3);
  vec2 g = q/cell + vec2(.5, .5);
  vec2 id = floor(g), f = (fract(g) - .5)*cell;
  float dist = length(id*vec2(1., 1.2));
  // a pancada: no centro primeiro, a correr para fora na queda
  float delay = dist*.08*(.3 + DROP);
  float push = clamp(.25*BASS + .9*exp(-fract(BPH - delay)*6.)*(.3 + .7*E) + .6*DROP*exp(-fract(BPH - delay)*3.), 0., 1.5);
  vec3 c = vec3(.012,.012,.014);
  float box = sdBox(f, cell*.5 - .006);
  float bevel = smoothstep(.0, .012, -box);
  vec3 tolex = vec3(.03,.03,.035)*(.8 + .4*noise(q*300.));
  c = mix(vec3(.004), tolex, bevel);
  c += vec3(.15)*smoothstep(.004, .0, abs(box + .006))*(.3 + .7*smoothstep(-.2, .2, f.y));
  // o woofer
  vec2 wc = f - vec2(0., .02);
  float rr = .112;
  float r = length(wc)/rr;
  if(r < 1.08){
    // perfil do cone: côncavo, com a tampa de pó no meio
    float h = r < .28 ? -.2 + .25*(1. - r*r/.08) : -(1. - r)*.6;
    vec2 n2 = normalize(wc + 1e-5)*(r < .28 ? -1. : .5);
    float lit = .5 + .5*dot(n2, normalize(vec2(-.5, .8)));
    float sc = 1. + .35*push;
    vec3 cone = vec3(.05,.05,.06)*(.5 + lit*(.8 + .6*push));
    cone += vec3(.35)*pow(max(0., lit), 12.)*(.2 + .8*push)*smoothstep(1., .9, r);
    // a borracha à volta
    float sur = smoothstep(.08, .0, abs(r - .95));
    cone = mix(cone, vec3(.08)*(1. + push) + vec3(.5)*pow(max(0., dot(normalize(wc), vec2(-.4, .9))), 8.)*.4, sur);
    // anel de luz da cor da capa por trás dos cones nas secções fortes
    cone += nc(id.x*.1 + id.y*.2 + BEATN*.05)*smoothstep(.06, .0, abs(r - 1.03))*(.4 + 1.6*push)*(.3 + SEC);
    c = mix(c, cone, smoothstep(1.08, 1.04, r));
  }
  // o ar a tremer à frente
  c += nc(.5)*.25*smoothstep(.015, .0, abs(length(wc) - rr*(1.1 + BPH*.8)))*exp(-BPH*3.)*E;
  // o tweeter e a plaquinha com a capa
  vec2 tc = f - vec2(.0, -.11);
  float tr = length(tc);
  c = mix(c, vec3(.03) + vec3(.4)*pow(max(0., dot(normalize(tc + 1e-5), vec2(-.5,.8))), 6.)*smoothstep(.02, .0, tr)*(.3 + push), smoothstep(.022, .02, tr));
  vec2 bq = f - vec2(.1, -.12);
  float bd = sdBox(bq, vec2(.018));
  if(bd < 0.) c = cov(bq/.036 + .5)*.8;
  // luz por trás das caixas, nos intervalos
  c += nc(.0)*.6*smoothstep(.0, -.004, -box - .004)*0. ;
  c += nc(.8)*(.02 + .9*DROP + .25*k*SEC)*smoothstep(.01, .0, -box)*step(0., box + .006);
  c *= 1. - .35*length(p*vec2(.6, .9));
  c += vec3(1.)*.18*DROP*k;
  c = aces(c*1.5);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
