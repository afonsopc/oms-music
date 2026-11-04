/**
 * Fitas de Möbius: uma fita de metal polido com meia volta (ou três, ou
 * cinco, conforme a secção) a rodar no escuro, com faixas de luz a correr
 * por ela ao andamento. Os graves torcem-na mais, a queda acende-a toda.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "mobius",
  name: "Fita de Möbius",
  names: { en: "Möbius strip", lv: "Mēbiusa lente" },
  families: ["calm", "electronic"],
  tags: ["3d", "metal", "topologia", "matemática"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, HEAD + `
float TW;
vec2 bandUV;
float map(vec3 p){
  float a = atan(p.z, p.x);
  vec2 q = vec2(length(p.xz) - 1., p.y);
  float tw = a*TW*.5 + TF*.2;
  q = rot(tw)*q;
  bandUV = vec2(a, q.x);
  vec2 d = abs(q) - vec2(.36 + .05*B, .035);
  return (min(max(d.x,d.y),0.) + length(max(d,0.)))*.55;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  TW = 1. + 2.*mod(SG + floor(SEED*3.), 3.);
  float t = TF*.12;
  vec3 ro = vec3(0., .9 + .5*sin(t*.7), 3.1 - .4*PK);
  ro.xz = rot(t)*ro.xz;
  vec3 fw = normalize(-ro), rt = normalize(cross(fw, vec3(0,1,0))), up = cross(rt, fw);
  vec3 rd = normalize(p.x*rt + p.y*up + (1.7 + .25*KICK)*fw);
  float tt = 1.2, d;
  float maxS = Q > 1.5 ? 90. : 60.;
  for(int i=0;i<90;i++){
    if(float(i) >= maxS) break;
    d = map(ro + rd*tt);
    if(d < .001 || tt > 6.) break;
    tt += d;
  }
  vec3 col = C1*.04 + vivid(C2)*.03*(1. - length(p));
  if(tt < 6.){
    vec3 pos = ro + rd*tt;
    map(pos);
    vec2 bu = bandUV;
    vec2 e = vec2(.002, 0.);
    vec3 n = normalize(vec3(map(pos+e.xyy)-map(pos-e.xyy), map(pos+e.yxy)-map(pos-e.yxy), map(pos+e.yyx)-map(pos-e.yyx)));
    vec3 r = reflect(rd, n);
    // ambiente de estúdio nas cores da capa: céu, chão, duas janelas de luz
    vec3 env = mix(C1*.15, vivid(C2)*.9, smoothstep(-.2, .8, r.y));
    env += vivid(C3)*smoothstep(.9, .98, dot(r, normalize(vec3(.6, .3, .7))))*1.5;
    env += vec3(1.)*smoothstep(.95, .99, dot(r, normalize(vec3(-.7, .5, -.2))));
    float fres = .25 + .75*pow(1. - abs(dot(n, rd)), 3.);
    col = env*fres + C1*.08;
    // faixas a correr ao longo da fita, uma por batida
    float stripe = fract(bu.x/TAU*8. - (BN + BP)*.25);
    float s = smoothstep(.0, .04, stripe)*smoothstep(.16, .04, stripe);
    col += vivid(pal(bu.x/TAU + TF*.03))*s*(.5 + 1.5*BEAT + 2.*DROP);
    col += vivid(C3)*smoothstep(.33, .36, abs(bu.y))*(.6 + KICK);
  }
  col *= .85 + .35*E;
  col *= 1. - .3*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`);
