/** Plasma à antiga, nas cores da capa. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "plasma",
  name: "Plasma",
  names: { en: "Plasma", lv: "Plazma" },
  families: ["calm"],
  tags: ["demoscene", "cor"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "palette"],
  lyrics: "ink",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.)*3.;
  float t = T*.6;
  float v = sin(p.x*1.7+t) + sin(p.y*2.1-t*1.3) + sin((p.x+p.y)*1.3+t*.7) + sin(length(p*(1.+B))*3.-t*2.);
  vec3 c = pal(v*.12 + T*.03 + BAR*.05);
  c *= .65 + .5*E + .35*BEAT;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
