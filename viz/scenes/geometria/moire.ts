/**
 * Moiré: três famílias de anéis concêntricos sobrepostas, cada uma presa a
 * uma faixa (graves, médios, agudos). Onde se cruzam nascem franjas que
 * correm sozinhas. A batida aperta os anéis, a queda inverte a imagem.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "moire",
  name: "Moiré",
  names: { en: "Moiré", lv: "Muarē" },
  families: ["electronic", "calm"],
  tags: ["óptico", "hipnótico", "geométrico", "preto e branco"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "mid", "high", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, HEAD + `
float rings(vec2 p, vec2 c, float k, float ph){
  float r = length(p-c);
  return sin(r*k - ph);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float t = TF*.25;
  vec2 c1 = .32*vec2(sin(t*.9+SEED*6.), cos(t*.7))*(1.+.6*B);
  vec2 c2 = .32*vec2(sin(t*.6+2.), cos(t*1.1+1.))*(1.+.6*M);
  vec2 c3 = .32*vec2(sin(t*1.3+4.), cos(t*.5+3.))*(1.+.6*H);
  float k = 65. + 25.*sin(TF*.07) + 25.*KICK + 30.*PK;
  float a = rings(p, c1, k, TF*2.);
  float b = rings(p, c2, k*1.03, TF*1.7);
  float c = rings(p*rot(.03*sin(t)), c3, k*.97, -TF*1.3);
  // modos por secção: dois anéis, três anéis, ou anéis contra riscas
  float mode = mod(SG + floor(SEED*3.), 3.);
  float d = mode < 1. ? a*b : mode < 2. ? a*b*c*1.6 : a*sin(dot(p, vec2(cos(t*.3),sin(t*.3)))*k*.9);
  float aa = fwidth(d)*1.5;
  float bw = smoothstep(-aa, aa, d);
  // a franja de baixa frequência (o moiré propriamente dito) leva a cor
  float lowf = .5+.5*sin(length(p-c1)*k - length(p-c2)*k*1.03 - TF*.3);
  vec3 tint = mix(vivid(C1), vivid(C2), lowf);
  tint = mix(tint, vivid(C3), smoothstep(.6,1.,lowf)*H);
  vec3 col = mix(vec3(.02), tint, bw);
  col = mix(col, 1.-col, step(.5, fract(DROP*3.))*step(.05, DROP));
  col *= .7 + .4*E + .5*BEAT*bw;
  col *= 1. - .35*dot(p,p) - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(col, gl_FragCoord.xy), 1.);
}`);
