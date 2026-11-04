/** Tinta: manchas de tinta a abrir num papel, calmas, para o fado e o acústico. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "ink",
  name: "Tinta",
  names: { en: "Ink", lv: "Tinte" },
  families: ["calm"],
  tags: ["papel", "acústico", "suave"],
  intensity: 1,
  cost: 1,
  signals: ["energy", "palette"],
  lyrics: "ink",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float t = T*.04;
  vec2 q = p*1.4;
  q += .3*vec2(fbm(q+t), fbm(q-t+5.));
  float n = fbm(q*2. + vec2(t*3., -t));
  float ink = smoothstep(.55 - .15*E, .62 - .15*E, n);
  float edge = smoothstep(.0,.04, abs(n - (.58 - .15*E))) ;
  vec3 paper = vec3(.93,.9,.84) - .06*fbm(p*30.);
  vec3 tint = mix(vec3(.08,.08,.12), C1*.5, .35);
  vec3 c = mix(paper, tint, ink);
  c = mix(c*.85, c, edge);
  c *= 1. - .25*dot(p,p);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
