/** Película: a capa em grão de filme, devagar, com a luz a respirar. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "film",
  name: "Película",
  names: { en: "Film", lv: "Filma" },
  families: ["calm"],
  tags: ["capa", "grão", "acústico"],
  intensity: 1,
  cost: 1,
  signals: ["energy", "cover"],
  lyrics: "ink",
}, GLSL_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.);
  cu *= 1.05 - .05*sin(T*.1);
  cu *= rot(.02*sin(T*.07));
  vec3 c = texture(COVER, cu*.8+.5).rgb;
  float l = dot(c, vec3(.3,.59,.11));
  c = mix(vec3(l), c, .55) * vec3(1.05,1.,.92);
  c += (hash(u*R*.5 + floor(T*24.))-.5)*.12;
  float scratch = step(.996, hash(vec2(floor(u.x*R.x/2.), floor(T*24.))));
  c += scratch*.25;
  c *= .75 + .35*E;
  c *= smoothstep(.95,.3, length(u-.5)*1.25);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
