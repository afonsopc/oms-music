/** Cidade de voxels: um voo rasante sobre prédios que crescem com a música. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "voxel",
  name: "Cidade de voxels",
  names: { en: "Voxel city", lv: "Vokseļu pilsēta" },
  families: ["electronic"],
  tags: ["cidade", "3d", "voo"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "palette"],
  lyrics: "neon",
}, GLSL_HEAD + `
float city(vec3 p){
  vec2 id = floor(p.xz); vec2 f = fract(p.xz)-.5;
  float h = hash(id)*1.4 + .2 + 1.2*B*hash(id+3.) + .8*BEAT*step(.8,hash(id+7.));
  float box = max(max(abs(f.x),abs(f.y))-.38, p.y-h);
  return max(box, -p.y);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 ro = vec3(sin(T*.2)*2., 2.4, T*(2.+3.*E));
  vec3 rd = normalize(vec3(p.x, p.y-.35, 1.));
  rd.xy *= rot(.08*sin(T*.3));
  float t = 0.; bool hit = false;
  for(int i=0;i<90;i++){ float d = city(ro+rd*t); if(d<.002){hit=true;break;} t += max(d*.6,.01); if(t>40.) break; }
  vec3 c = mix(vec3(.02,.01,.06), C1*.3, smoothstep(-.2,.6,rd.y));
  if(hit){
    vec3 q = ro+rd*t; vec2 id = floor(q.xz);
    float win = step(.82, hash(floor(q.xz*5.)+floor(q.y*5.))) * step(.05, q.y);
    vec3 lit = mix(C2, C3, hash(id));
    float shade = .1 + .12*hash(id+1.);
    c = vec3(shade)*mix(vec3(1.), C1, .4) + lit*win*(.55+1.2*BEAT);
    c = mix(c, vec3(.05,.02,.1), 1.-exp(-t*.05));
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
