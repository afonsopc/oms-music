/**
 * Truchet: um labirinto de tubos feito de quartos de círculo, com luz a
 * correr dentro deles ao andamento da música. Em cada compasso uma parte
 * dos ladrilhos vira-se e o caminho muda; os graves engrossam os tubos.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "truchet",
  name: "Truchet",
  names: { en: "Truchet", lv: "Trušē" },
  families: ["electronic"],
  tags: ["labirinto", "geométrico", "néon", "ladrilhos"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "high", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float sc = 6. + 3.*mod(SG, 3.) - 2.*PK;
  vec2 q = rot(.1*sin(TF*.07))*p*sc + vec2(TF*.15, TF*.08);
  vec2 id = floor(q), f = fract(q) - .5;
  // o ladrilho vira-se no compasso (com uma animação curta)
  // estado = paridade de quantas vezes já se virou (cerca de 30 % por compasso)
  float rotB = step(.5, hash(id*1.7));
  float rotA = rotB;
  for(int k=0;k<4;k++){ float n = BARN - float(k); rotB = mod(rotB + step(hash(id + n*.731), .3), 2.); }
  rotA = mod(rotB + step(hash(id + (BARN+1.)*.731), .3), 2.);
  float tAnim = smoothstep(0., .12, fract(BAR));
  float ang = mix(rotB, rotA, tAnim) * PI*.5;
  f = rot(ang)*f;
  // dois arcos de quarto de círculo
  vec2 a = f - vec2(.5); vec2 b = f + vec2(.5);
  float da = abs(length(a) - .5), db = abs(length(b) - .5);
  float d = min(da, db);
  // coordenada ao longo do tubo, para a luz correr
  vec2 cc = da < db ? a : b;
  float along = atan(cc.y, cc.x)/(PI*.5);
  float dir = (mod(id.x + id.y, 2.) < 1. ? 1. : -1.) * (da < db ? 1. : -1.);
  float w = .11 + .07*B + .05*KICK;
  float tube = smoothstep(w, w - .03, d);
  float shade = sqrt(max(0., 1. - (d/w)*(d/w)));
  float flow = fract(along*dir*.5 + (BN + BP)*.5 + hash(id)*0.);
  float pulse = smoothstep(.0, .1, flow)*smoothstep(.35, .1, flow);
  vec3 c = pal(hash(id)*.3 + (id.x+id.y)*.03 + TF*.02);
  vec3 neon = vivid(c);
  vec3 col = vec3(.015) + C1*.05;
  col = mix(col, c*.35*shade + neon*shade*shade*.3, tube);
  col += neon * tube * pulse * (.6 + 1.2*BEAT + DROP) ;
  col += neon * exp(-d*18.) * .15 * (1. + H);
  col += vec3(1.)*tube*pow(shade, 20.)*.5;
  col *= .75 + .4*E + .3*PK;
  col *= 1. - .3*dot(p,p) - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`);
