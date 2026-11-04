/** Caleidoscópio sobre a capa: seis fatias, a rodar no compasso. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "kaleido",
  name: "Caleidoscópio",
  names: { en: "Kaleidoscope", lv: "Kaleidoskops" },
  families: ["calm", "electronic"],
  tags: ["capa", "simetria"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "bar", "cover", "palette"],
  lyrics: "ink",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float r = length(p), a = atan(p.y,p.x);
  float seg = 6. + 2.*floor(mod(BAR,4.));
  a = mod(a, 6.2831/seg); a = abs(a - 3.1416/seg);
  vec2 k = vec2(cos(a), sin(a))*r;
  k = rot(T*.1 + BAR*.25)*k * (1.2 - .3*B);
  vec3 c = texture(COVER, k*.9 + .5 + .05*vec2(sin(T*.3), cos(T*.2))).rgb;
  c = mix(c, pal(r - T*.1), .25 + .3*H);
  c *= .7 + .6*E + .4*BEAT;
  o = vec4(post(c*(1.-.4*r), gl_FragCoord.xy), 1.);
}`);
