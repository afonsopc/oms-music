/**
 * Ferrofluido: uma poça de líquido negro e espelhado num prato; os graves
 * são o íman por baixo e levantam espinhos em favo, a batida fá-los saltar,
 * um segundo íman dá a volta no compasso e arrasta uma onda de espinhos, a
 * queda põe-nos em pé de uma vez. O líquido reflecte um estúdio com luzes
 * nas cores da capa e a própria capa no tecto.
 */
import { FIS_HEAD } from "./_lib";
import { shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "ferrofluido",
  name: "Ferrofluido",
  names: { en: "Ferrofluid", lv: "Ferošķidrums" },
  families: ["chaos", "calm"],
  tags: ["3d", "líquido", "metal", "escuro", "íman"],
  intensity: 4,
  cost: 2,
  signals: ["bass", "beat", "bar", "drop", "palette", "cover"],
  lyrics: "extrude",
}, FIS_HEAD + `
vec2 mag;
float SP;
vec2 hexc(vec2 p){
  vec2 s = vec2(1., 1.7320508);
  vec2 a = mod(p, s) - s*.5, b = mod(p - s*.5, s) - s*.5;
  return dot(a,a) < dot(b,b) ? p - a : p - b;
}
float amp(vec2 c){
  float r2 = dot(c,c);
  float a = SP*exp(-r2*2.);
  a *= 1. + 1.6*exp(-dot(c-mag,c-mag)*5.);
  return a*(.85 + .3*hash(c*7.3));
}
float height(vec2 q){
  float r2 = dot(q,q);
  if(r2 > .7) return -1.;
  float h = .2*sqrt(max(0., 1. - r2/.64)) - .035;
  float edge = smoothstep(.8, .45, sqrt(r2));
  float sc = 7.5;
  vec2 c = hexc(q*sc)/sc;
  float d = length(q - c)*sc;
  float a = amp(c);
  h += a*edge*pow(max(0., 1. - d*1.85), 2.2);
  return h;
}
float map(vec3 p){
  float dPud = (p.y - height(p.xz))*.26;
  float dDish = p.y + .02;
  return min(dPud, dDish);
}
vec3 env(vec3 d){
  vec3 c = mix(vec3(.01), vivid(C1)*.08, smoothstep(-.2,.6,d.y));
  // três caixas de luz nas cores da capa
  float a = atan(d.z, d.x);
  for(int i=0;i<3;i++){
    float ai = float(i)*2.094 + BAR*.25;
    float k = pow(max(0., cos(a-ai)), 6.) * smoothstep(0.,.35,d.y)*smoothstep(.95,.45,d.y);
    c += k*vivid(i==0?C1:i==1?C2:C3)*(1.1 + 1.5*BEAT);
  }
  // a capa no tecto
  if(d.y > .7){ vec2 cu = d.xz/d.y*.9 + .5; c += texture(COVER, cu).rgb*smoothstep(.7,.95,d.y)*.6; }
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float bp = fract(BAR);
  float ang = BAR*1.5708;
  mag = .35*vec2(cos(ang), sin(ang));
  SP = .03 + .17*B + .07*BEAT + .14*DROP;
  float ca = T*.07;
  vec3 ro = vec3(sin(ca)*1.9, 1.2 - .15*E, -cos(ca)*1.9);
  vec3 ta = vec3(0., .05, 0.);
  vec3 f = normalize(ta-ro), r = normalize(cross(vec3(0,1,0), f)), u = cross(f, r);
  vec3 rd = normalize(f*1.6 + p.x*r + p.y*u);
  float t = 0.;
  bool hit = false;
  for(int i=0;i<110;i++){
    vec3 q = ro + rd*t;
    float d = map(q);
    if(d < .0008){ hit = true; break; }
    t += d;
    if(t > 5.) break;
  }
  vec3 col;
  if(hit){
    vec3 q = ro + rd*t;
    vec2 e = vec2(.0025, 0.);
    float hx = height(q.xz+e.xy) - height(q.xz-e.xy), hz = height(q.xz+e.yx) - height(q.xz-e.yx);
    vec3 n = q.y < -.015 ? vec3(0,1,0) : normalize(vec3(-hx, 2.*e.x, -hz));
    float fr = .12 + .88*pow(1. - max(dot(-rd, n), 0.), 5.);
    vec3 rf = reflect(rd, n);
    bool dish = q.y < -.015;
    vec3 base = dish ? vec3(.025) + vivid(C2)*.015 : vec3(.0);
    float occ = dish ? .4 + .6*smoothstep(0., .8, length(q.xz)) : 1.;
    col = base*occ + env(rf)*(dish ? .07 : .2 + .9*fr)*occ;
    col *= exp(-t*t*.03);
  } else col = env(rd)*.15;
  col *= 1. - .35*dot(p,p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`);
