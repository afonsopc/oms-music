/** Galáxia de partículas: uma espiral de estrelas que gira mais depressa nos graves. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "galaxy",
  name: "Galáxia",
  names: { en: "Galaxy", lv: "Galaktika" },
  families: ["calm", "electronic"],
  tags: ["espaço", "partículas"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "palette"],
  lyrics: "neon",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p *= rot(.3) ; p.y *= 1.6;
  float r = length(p), a = atan(p.y,p.x);
  vec3 c = vec3(0.);
  float spin = T*(.15+.4*B) + BAR*.1;
  for(int k=0;k<3;k++){
    float fk = float(k);
    float arm = sin(a*2. - log(r+.001)*5. + spin + fk*2.09);
    float dens = smoothstep(.4,1.,arm) * exp(-r*2.2);
    vec2 g = vec2(a*40.+fk*13., r*120.);
    float star = step(.985 - .02*E, hash(floor(g))) * dens * 6.;
    c += mix(C2, C3, fk*.5) * dens * .5 + vec3(star);
  }
  c += mix(vec3(1.,.9,.7), C2, .3) * exp(-r*9.)*(1.+2.*BEAT);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
