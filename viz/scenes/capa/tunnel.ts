/** Túnel: a capa a forrar um túnel que acelera com os graves. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "tunnel",
  name: "Túnel",
  names: { en: "Tunnel", lv: "Tunelis" },
  families: ["electronic", "chaos"],
  tags: ["capa", "velocidade"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "cover", "palette"],
  lyrics: "neon",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p *= rot(.2*sin(T*.4) + BEAT*.15);
  float r = length(p) + 1e-3, a = atan(p.y,p.x);
  float speed = T*(.35 + .6*E) + BAR*.25;
  vec2 t = vec2(a/3.1416, .35/r + speed);
  vec3 c = texture(COVER, t).rgb;
  float rings = .5+.5*sin(.35/r*6. - speed*12.);
  c = mix(c, pal(t.y*.2), .2) * (.55 + .5*rings*B);
  c *= smoothstep(0., .35, r) * (1. + .6*BEAT);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
