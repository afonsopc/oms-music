/**
 * Grelha infinita: um voo por um cristal sem fim de esferas espelhadas. As
 * esferas incham numa onda que sai da câmara em cada batida, os graves
 * aceleram o voo, a queda acende o cristal todo de uma vez.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "esferas",
  name: "Grelha infinita",
  names: { en: "Infinite lattice", lv: "Bezgalīgais režģis" },
  families: ["electronic"],
  tags: ["3d", "esferas", "cristal", "velocidade"],
  intensity: 4,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, HEAD + `
vec3 RO;
float rad(vec3 cell){
  float h = hash(cell.xy + cell.z*7.31);
  float dist = length(cell - RO);
  float wave = exp(-pow(dist - BP*9., 2.)*.5) * BEAT;
  return .16 + .1*h + .12*wave + .06*B;
}
float map(vec3 p, out vec3 cell){
  cell = floor(p) + .5;
  vec3 q = p - cell;
  return length(q) - rad(cell);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float t = TF*.9 + TZ*2.;
  RO = vec3(.08*sin(TF*.13), .08*cos(TF*.11), t);
  vec3 fw = normalize(vec3(.25*sin(TF*.07), .2*cos(TF*.05), 1.));
  vec3 rt = normalize(cross(fw, vec3(sin(TF*.05 + SG), cos(TF*.05 + SG), 0.))), up = cross(rt, fw);
  vec3 rd = normalize(p.x*rt + p.y*up + (1.1 - .2*KICK)*fw);
  float tt = 0., d; vec3 cell;
  float maxS = Q > 1.5 ? 72. : 48.;
  float glow = 0.;
  for(int i=0;i<72;i++){
    if(float(i) >= maxS) break;
    d = map(RO + rd*tt, cell);
    // passos curtos: a esfera do lado pode estar mais perto que a desta célula
    d = min(d, .45);
    glow += .012/(.02 + d*d*40.);
    if(d < .002 || tt > 14.) break;
    tt += d;
  }
  vec3 fogc = C1*.12;
  vec3 col = fogc;
  if(tt < 14.){
    vec3 pos = RO + rd*tt;
    vec3 n = normalize(pos - cell);
    vec3 r = reflect(rd, n);
    float h = hash(cell.xy + cell.z*7.31);
    vec3 tint = vivid(pal(h + cell.z*.02 + TF*.02));
    vec3 env = mix(C1*.2, tint, smoothstep(-.3, .9, r.z)) + vec3(1.)*pow(max(0., dot(r, normalize(vec3(.3,.6,1.)))), 30.);
    float fres = .2 + .8*pow(1. - max(0., dot(n, -rd)), 2.);
    col = env*fres;
    float lit = step(.92 - .25*PK, hash(cell.xy*1.3 + cell.z + BN*.17));
    col += tint*lit*(.6 + 1.2*BEAT);
    col = mix(col, fogc, 1. - exp(-tt*.11));
  }
  col += vivid(C2)*glow*.012*(.4 + DROP + .5*E);
  col *= .8 + .4*E;
  col *= 1. - .25*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`);
