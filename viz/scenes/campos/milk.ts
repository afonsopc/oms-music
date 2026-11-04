/** A cena MilkDrop: o frame anterior deformado (zoom, rotação, ondas) e formas novas por cima. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "milk",
  name: "Retorno",
  names: { en: "Feedback", lv: "Atgriezeniskā saite" },
  families: ["calm", "electronic", "chaos"],
  tags: ["psicadélico", "retorno"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "mid", "high", "beat", "bar", "onset", "palette"],
  lyrics: "ink",
}, GLSL_HEAD + `
void main(){
  vec2 p = uv-.5; p.x *= R.x/R.y;
  float zoom = .985 - .02*B - .012*BEAT;
  float ang = .004 + .02*sin(T*.21) + .03*ON*sign(sin(BAR*3.14));
  vec2 q = rot(ang)*p*zoom;
  q += .006*vec2(sin(q.y*9.+T), cos(q.x*7.-T*1.3))*(1.+2.*M);
  q.x /= R.x/R.y;
  vec3 prev = texture(PREV, q+.5).rgb;
  prev *= .965 - .02*H;
  // um anel de onda a nascer no centro, a cor da capa a rodar
  float r = length(p);
  float ring = smoothstep(.012,.0, abs(r - (.12+.25*E + .03*sin(atan(p.y,p.x)*6.+T*2.)*(.5+M))));
  vec3 add = pal(T*.05 + r) * ring * (.6+1.4*BEAT);
  // faíscas nos ataques
  float sp = step(.997 - .01*ON, hash(floor(uv*R/3.) + floor(T*30.)));
  add += sp * C3 * ON * 2.;
  o = vec4(post(clamp(prev + add, 0., 1.), gl_FragCoord.xy), 1.);
}`, { feedback: true });
