/**
 * Cristal facetado: a capa vista através de um bloco de cristal lapidado em
 * triângulos. Cada faceta desvia a imagem e separa as cores (dispersão), as
 * arestas faíscam com os agudos. Em cada batida uma onda de facetas vira-se,
 * os graves aumentam a refracção, a queda estilhaça o cristal.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "cristal",
  name: "Cristal facetado",
  names: { en: "Faceted crystal", lv: "Slīpēts kristāls" },
  families: ["calm", "electronic"],
  tags: ["capa", "vidro", "prisma", "brilho"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "drop", "section", "cover", "palette"],
  lyrics: "ink",
  artwork: "own",
}, HEAD + `
// grelha de triângulos: devolve o centro do triângulo e a distância à aresta
vec3 tri(vec2 p, out vec2 id){
  vec2 s = vec2(1., .8660254);
  vec2 q = vec2(p.x/s.x - p.y/(2.*s.y), p.y/s.y);
  vec2 i = floor(q), f = fract(q);
  float up = step(f.x + f.y, 1.);
  id = vec2(i.x*2. + up, i.y);
  float e = up > .5 ? min(min(f.x, f.y), 1. - f.x - f.y) : min(min(1. - f.x, 1. - f.y), f.x + f.y - 1.);
  vec2 cq = i + (up > .5 ? vec2(1./3.) : vec2(2./3.));
  vec2 cen = vec2((cq.x + cq.y*.5)*s.x, cq.y*s.y);
  return vec3(cen, e);
}
void main(){
  vec2 u = pixuv(uv);
  vec2 p = (u-.5)*vec2(R.x/R.y,1.);
  float dens = 5. + 3.*mod(SG, 2.) + 4.*DROP;
  vec2 id;
  vec3 tr = tri(rot(.05*sin(TF*.1) + SEED)*p*dens, id);
  float h = hash(id), h2 = hash(id + 7.3);
  // cada faceta tem uma inclinação; a onda da batida vira-a
  float wave = exp(-pow(length(tr.xy)/dens*3. - BP*3., 2.)*3.)*BEAT;
  float tilt = (.03 + .05*B + .04*wave + .12*DROP) * (.6 + .8*h);
  float a = h2*TAU + TF*.1*(h - .5);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 base = vec2(u.x, 1. - u.y);
  // dispersão: o vermelho desvia menos que o azul
  vec3 col;
  col.r = texture(COVER, base + dir*tilt*.8).r;
  col.g = texture(COVER, base + dir*tilt).g;
  col.b = texture(COVER, base + dir*tilt*1.25).b;
  col *= .55 + .35*E + .35*h + .4*wave;
  // luz rasante na faceta e faíscas nas arestas
  float spec = pow(max(0., dot(dir, normalize(vec2(cos(TF*.2), sin(TF*.2))))), 12.);
  col += vec3(1.)*spec*.25*(.5 + h);
  float e = tr.z;
  col *= .75 + .25*smoothstep(0., .08, e);
  vec3 neon = vivid(pal(h*.5 + TF*.02));
  col += neon*exp(-e*40.)*(.25 + .9*H + .6*KICK);
  col += vec3(1.)*step(.996 - .02*H, hash(id + floor(T*12.)))*exp(-e*30.)*1.5;
  col = mix(col, col*vivid(C1)*1.2, .15);
  col *= 1. - .3*dot(p,p) - .2*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`);
