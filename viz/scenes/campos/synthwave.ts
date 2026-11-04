/** Synthwave: o sol às riscas e a grelha néon a correr para nós, nos graves. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "synthwave",
  name: "Synthwave",
  names: { en: "Synthwave", lv: "Synthwave" },
  families: ["electronic"],
  tags: ["néon", "anos-80", "grelha"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "palette"],
  lyrics: "neon",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 sky = mix(vec3(.05,.0,.12), mix(C2,vec3(1.,.3,.6),.5)*.55, smoothstep(-.1,.5,p.y));
  vec3 c = sky;
  // sol
  vec2 sp = p - vec2(0.,.12);
  float r = length(sp), sun = smoothstep(.3+.03*BEAT,.29+.03*BEAT, r);
  float stripes = step(.5, fract((sp.y+T*.03)*18.)) + step(.05, sp.y);
  c = mix(c, mix(vec3(1.,.85,.3), vec3(1.,.2,.55), clamp(.5-sp.y*2.,0.,1.)), sun*clamp(stripes,0.,1.));
  c += vec3(1.,.3,.6)*.4*exp(-r*4.)*(.6+E);
  // montanhas
  float m = .02 + .07*abs(sin(p.x*3.+1.)) + .04*abs(sin(p.x*7.3));
  if(p.y < m - .02) c = mix(vec3(.08,.0,.15), C1*.4, .3);
  // grelha
  if(p.y < -.02){
    float z = .35/(-p.y+.001);
    vec2 g = vec2(p.x*z, z + T*(1.5+4.*B));
    // perto de um inteiro = em cima de uma linha da grelha
    float wx = fwidth(g.x)*1.5 + .02, wy = fwidth(g.y)*1.5 + .02;
    float line = max(smoothstep(.5-wx,.5,abs(fract(g.x)-.5)), smoothstep(.5-wy,.5,abs(fract(g.y)-.5)));
    vec3 neon = mix(vec3(1.,.2,.8), C3+vec3(.2), .4);
    c = mix(vec3(.02,0.,.05), neon*(1.2+1.5*BEAT), line*exp(-z*.08));
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
