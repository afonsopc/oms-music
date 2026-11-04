/** VHS: a capa numa cassete gasta: tracking, ruído, cores a escorregar. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "vhs",
  name: "VHS",
  names: { en: "VHS", lv: "VHS" },
  families: ["chaos"],
  tags: ["capa", "glitch", "cassete"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "high", "beat", "bar", "onset", "cover"],
  lyrics: "glitch",
}, GLSL_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  float band = step(.97 - .05*BEAT, hash(vec2(floor(u.y*40.), floor(T*12.))));
  u.x += band*.04*sin(T*40.) + .003*sin(u.y*300.+T*20.)*(.5+H);
  float roll = fract(T*.05 + BAR*.02);
  u.y = fract(u.y + .02*smoothstep(.0,.02, abs(u.y-roll)-.0)*0.);
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.)*.9+.5;
  float sh = .006 + .02*ON;
  vec3 c = vec3(texture(COVER, cu+vec2(sh,0.)).r, texture(COVER, cu).g, texture(COVER, cu-vec2(sh,0.)).b);
  c = mix(c, vec3(dot(c,vec3(.3,.59,.11))), .25);
  c += (hash(u*R + T*60.)-.5)*.18;
  c *= .85 + .15*sin(u.y*R.y*1.5);
  c += vec3(1.)*smoothstep(.01,.0,abs(u.y-roll))*.25;
  c *= .7 + .5*E;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
