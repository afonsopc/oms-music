/**
 * Corredor de espelhos: dois espelhos frente a frente com a capa no meio,
 * molduras de néon que se repetem até ao infinito. O corredor dobra-se com
 * os médios, uma onda de luz corre para o fundo em cada batida, a queda
 * puxa-nos lá para dentro.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "espelhos",
  name: "Corredor de espelhos",
  names: { en: "Mirror corridor", lv: "Spoguļu koridors" },
  families: ["electronic", "calm"],
  tags: ["capa", "infinito", "néon", "espelho"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "mid", "beat", "drop", "section", "cover", "palette"],
  lyrics: "neon",
  artwork: "own",
}, HEAD + `
// o centro da moldura número k (a curva do corredor)
vec2 bend(float k){
  return vec2(sin(k*.35 + TF*.4), cos(k*.27 + TF*.31)) * (.035 + .05*M) * min(k, 6.)/6.;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float ratio = .82;
  float z = fract(TZ*.8 + TF*.05);      // avanço contínuo dentro de uma moldura
  vec3 col = vec3(0.);
  float found = 0.;
  vec2 prevQ = p/.62;
  // de fora para dentro: a primeira moldura que deixa o ponto de fora decide
  for(int i=0;i<24;i++){
    float k = float(i) - z;
    float sc = .62*pow(ratio, k);
    vec2 c = bend(k);
    vec2 q = (p - c)/sc;
    q = rot(.06*sin(k*.5 + TF*.2) + .15*SHIFT*sin(k))*q;
    vec2 aq = abs(q);
    float box = max(aq.x/1.45, aq.y);
    if(box < 1.){ prevQ = q; continue; }
    // entre esta moldura e a de fora: o reflexo da capa (espelhado em cada volta)
    float fi = float(i) + floor(TZ*.8 + TF*.05);
    float fade = pow(.86, k);
    vec2 cq = prevQ*vec2(1./1.45, 1.);
    cq.x *= mod(fi, 2.) < 1. ? 1. : -1.;
    vec3 cov = texture(COVER, vec2(.5, -.5)*cq + .5).rgb;
    col = cov*(.5 + .3*KICK)*fade*smoothstep(1.02, .7, max(abs(cq.x), abs(cq.y)));
    float d = (box - 1.)*sc;
    vec3 tint = vivid(pal(fi*.09 + TF*.01));
    float wave = exp(-pow(k - BP*10., 2.)*.6)*BEAT;
    col += tint*(smoothstep(.006, 0., d)*1.4 + .004/(d + .003))*fade*(.45 + 1.6*wave + DROP);
    col += C1*.04*fade;
    found = 1.;
    break;
  }
  if(found < .5) col = C1*.02;
  col *= .8 + .4*E + .3*PK;
  col *= 1. - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col), gl_FragCoord.xy), 1.);
}`);
