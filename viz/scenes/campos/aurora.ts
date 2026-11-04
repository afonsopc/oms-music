/** Fundo do leitor: aurora em domínio deformado, a respirar com a música. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "aurora",
  name: "Aurora",
  names: { en: "Aurora", lv: "Polārblāzma" },
  families: ["calm"],
  tags: ["suave", "fundo"],
  intensity: 1,
  cost: 1,
  signals: ["energy", "bass", "beat", "palette"],
  lyrics: "ink",
  background: true,
}, GLSL_HEAD + `
void main(){
  vec2 p = (uv-.5)*vec2(R.x/R.y,1.);
  float t = T*.06;
  vec2 q = vec2(fbm(p*1.3+t), fbm(p*1.3-t+4.2));
  vec2 w = p + (.55+.5*B)*q + .08*vec2(sin(T*.3), cos(T*.27));
  float n = fbm(w*1.6 + vec2(t*2., -t));
  float k = smoothstep(.15,.95,n);
  vec3 c = mix(C1*.55, C2, k);
  c = mix(c, C3, smoothstep(.55,1.,fbm(w*2.3-t*3.))*.7);
  c *= .72 + .45*E + .25*BEAT;
  float v = 1.-.55*dot(p*.9,p*.9);
  o = vec4(post(c*v, gl_FragCoord.xy), 1.);
}`);
