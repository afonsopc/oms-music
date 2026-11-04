/** Metal líquido: bolhas de mercúrio que se juntam e se separam ao ritmo. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "liquid",
  name: "Metal líquido",
  names: { en: "Liquid metal", lv: "Šķidrais metāls" },
  families: ["calm", "electronic"],
  tags: ["metal", "3d"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "mid", "beat", "palette"],
  lyrics: "ink",
}, GLSL_HEAD + `
float field(vec2 p){
  float v = 0.;
  for(int i=0;i<6;i++){
    float fi = float(i);
    vec2 c = .38*vec2(sin(T*(.31+.07*fi)+fi*2.1), cos(T*(.27+.05*fi)+fi*1.3)) * (1.+.5*B);
    v += (.035 + .02*BEAT + .015*(fi==0.?E:M)) / dot(p-c,p-c);
  }
  return v;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float f = field(p);
  vec2 e = vec2(.002,0.);
  vec3 n = normalize(vec3(field(p+e.xy)-field(p-e.xy), field(p+e.yx)-field(p-e.yx), .06));
  float inside = smoothstep(.9,1.1,f);
  vec3 env = mix(C1*.3, vec3(1.), .5+.5*n.y) ; env = mix(env, C3, .3*(.5+.5*n.x));
  float spec = pow(max(dot(n, normalize(vec3(.4,.6,1.))),0.), 30.);
  vec3 c = mix(vec3(.02), env*.9 + spec*(1.2+BEAT), inside);
  c += C2*.15*smoothstep(.5,.9,f)*(1.-inside);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
