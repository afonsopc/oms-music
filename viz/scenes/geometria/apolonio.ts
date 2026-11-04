/**
 * Catedral de Apolónio: uma viagem por dentro de um empacotamento de esferas
 * de Apolónio (inversões repetidas no espaço), como coral ou rendas de
 * pedra. Os graves abrem e fecham as juntas, a batida acende as esferas de
 * uma geração, a câmara acelera nas quedas.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "apolonio",
  name: "Catedral de Apolónio",
  names: { en: "Apollonian cathedral", lv: "Apolonija katedrāle" },
  families: ["calm", "electronic"],
  tags: ["fractal", "3d", "esferas", "matemática", "coral"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, HEAD + `
float S;
vec4 orb;
float map(vec3 p){
  float scale = 1.;
  orb = vec4(1000.);
  for(int i=0;i<7;i++){
    p = -1. + 2.*fract(.5*p + .5);
    float r2 = dot(p,p);
    orb = min(orb, vec4(abs(p), r2));
    float k = S/r2;
    p *= k;
    scale *= k;
  }
  return .25*abs(p.y)/scale;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  S = 1.18 + .07*sin(TF*.07) + .08*B + .05*DROP;
  float t = TF*.06;
  vec3 ro = vec3(.6 + .5*cos(t + SEED*6.), .55 + .2*sin(t*.7), 1.2 + .5*sin(t*.5));
  vec3 ta = vec3(1.1 + .4*sin(t*.9), .4, .2*cos(t*1.3));
  vec3 fw = normalize(ta - ro), rt = normalize(cross(fw, vec3(0,1,0))), up = cross(rt, fw);
  vec3 rd = normalize(p.x*rt + p.y*up + (1.4 - .3*KICK)*fw);
  float maxS = Q > 2.5 ? 110. : Q > 1.5 ? 80. : 55.;
  float tt = .01, d = 0.;
  float st = 0.;
  for(int i=0;i<110;i++){
    if(float(i) >= maxS) break;
    d = map(ro + rd*tt);
    if(d < .0004*tt || tt > 6.) break;
    tt += d;
    st += 1.;
  }
  vec3 col;
  vec3 fogc = C1*.08;
  if(tt < 6.){
    vec3 pos = ro + rd*tt;
    vec4 tr = orb;
    vec2 e = vec2(.0007*tt, 0.);
    vec3 n = normalize(vec3(map(pos+e.xyy)-map(pos-e.xyy), map(pos+e.yxy)-map(pos-e.yxy), map(pos+e.yyx)-map(pos-e.yyx)));
    float ao = clamp(1. - st/maxS, 0., 1.);
    ao = ao*ao;
    vec3 base = mix(vivid(C2), vivid(C3), clamp(tr.x*2., 0., 1.));
    base = mix(base, C1, clamp(tr.y*3., 0., 1.)*.5);
    float gen = floor(tr.w*6.);
    float lit = step(.5, fract(gen*.37 + BN*.25)) * BEAT;
    vec3 l = normalize(vec3(-.4, .8, .3));
    float dif = clamp(dot(n, l), 0., 1.);
    float rim = pow(1. - abs(dot(n, -rd)), 3.);
    col = base*(.12 + .9*dif)*ao + vivid(base)*rim*.6*ao;
    col += vivid(C3)*pow(clamp(1. - tr.w, 0., 1.), 6.)*(1.5*lit + .4*DROP + .2);
    col = mix(col, fogc, 1. - exp(-tt*.35));
  } else col = fogc;
  col += vivid(C2)*st/maxS*.15*(1. + KICK);
  col *= .8 + .4*E + .3*PK;
  col *= 1. - .3*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.4), gl_FragCoord.xy), 1.);
}`);
