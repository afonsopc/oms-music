/** Cromado de render antigo: um cubo/toro com a capa, luz "por omissão" e reflexo do céu. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "chrome",
  name: "Cromado",
  names: { en: "Chrome", lv: "Hroms" },
  families: ["electronic", "chaos"],
  tags: ["capa", "3d", "demoscene"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "bar", "cover", "palette"],
  lyrics: "extrude",
}, GLSL_HEAD + `
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float shapeSel(){ return mod(floor(BAR/4.), 3.); }
float map(vec3 p){
  float s = 1. + .18*BEAT + .1*B;
  p.xz *= rot(T*.6 + BAR*.5); p.xy *= rot(T*.37);
  float k = shapeSel();
  float d = k < .5 ? sdBox(p, vec3(.75*s)) - .04 : k < 1.5 ? sdTorus(p, vec2(.8*s, .3*s)) : length(p) - .95*s;
  return d;
}
vec3 nrm(vec3 p){ vec2 e=vec2(.002,0); return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx))); }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 ro = vec3(0,0,3.2), rd = normalize(vec3(p, -1.6));
  float t = 0.; bool hit = false;
  for(int i=0;i<80;i++){ float d = map(ro+rd*t); if(d<.001){ hit=true; break; } t += d; if(t>8.) break; }
  // fundo: grelha de chão a fugir, ao estilo das demos antigas
  vec3 bg = mix(C1*.15, C2*.35, uv.y);
  vec2 g = vec2(p.x/(.6-p.y+.001), 1./(.6-p.y+.001) + T*(1.+2.*E));
  float grid = (p.y < .1) ? smoothstep(.06,.0, min(abs(fract(g.x)-.5), abs(fract(g.y)-.5))) : 0.;
  bg += grid * C3 * (.4 + 1.2*BEAT) * smoothstep(.1,-.4,p.y);
  vec3 c = bg;
  if(hit){
    vec3 pos = ro+rd*t, n = nrm(pos);
    vec3 q = pos; q.xz *= rot(T*.6 + BAR*.5); q.xy *= rot(T*.37);
    vec3 an = abs(n);
    vec2 tuv = an.x>an.y&&an.x>an.z ? q.yz : an.y>an.z ? q.xz : q.xy;
    vec3 tex = texture(COVER, tuv*.6+.5).rgb;
    vec3 l = normalize(vec3(.6,.8,.5));
    float dif = max(dot(n,l),0.), spec = pow(max(dot(reflect(-l,n),-rd),0.), 48.);
    vec3 env = mix(C2, vec3(1), .5+.5*reflect(rd,n).y);
    c = tex*(.25+.9*dif) + .55*env*pow(1.-max(dot(n,-rd),0.),2.) + spec*(1.+BEAT);
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
