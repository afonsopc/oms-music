/** Datamosh: o frame anterior escorrega aos blocos, a capa infiltra-se nos ataques. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "datamosh",
  name: "Datamosh",
  names: { en: "Datamosh", lv: "Datamosh" },
  families: ["chaos"],
  tags: ["capa", "glitch", "retorno"],
  intensity: 5,
  cost: 1,
  signals: ["bass", "beat", "onset", "cover"],
  lyrics: "glitch",
}, GLSL_HEAD + `
void main(){
  vec2 u = uv;
  vec2 blk = floor(u*vec2(24.,14.));
  vec2 mv = (vec2(hash(blk+floor(T*4.)), hash(blk+7.+floor(T*4.)))-.5) * (.01 + .05*B);
  vec3 prev = texture(PREV, u - mv).rgb;
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.)*.95+.5;
  vec3 cov = texture(COVER, cu + mv*2.).rgb;
  float inject = step(.92 - .4*ON - .3*BEAT, hash(blk + floor(T*10.)));
  vec3 c = mix(prev*.995, cov, max(inject, .02));
  if(hash(vec2(floor(T*8.), 3.)) > .9) c = c.gbr;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, { feedback: true });
