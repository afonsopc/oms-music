/**
 * Lava: um lago de lava visto de cima, em perspectiva. Placas de crosta
 * negra à deriva e, entre elas, fendas incandescentes que se abrem com os
 * graves. Nas batidas rebenta uma bolha; nas quedas a crosta parte-se toda
 * e o calor sobe até ao branco. O brilho vai do escuro às cores da capa.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "lava",
  name: "Lava",
  names: { en: "Lava", lv: "Lava" },
  families: ["electronic", "chaos"],
  tags: ["natureza", "quente", "fogo", "escuro"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, NAT_GLSL + `
vec3 heat(float k){
  // do negro às cores da capa até ao branco
  vec3 a = mix(vivid(C1), vec3(.6,.08,.02), .5)*.45, b = vivid(C1), c = mix(vivid(C2), vec3(1.,.85,.5), .3);
  vec3 col = mix(vec3(0.), a, smoothstep(.12, .4, k));
  col = mix(col, b*1.4, smoothstep(.2, .55, k));
  col = mix(col, c*2., smoothstep(.5, .85, k));
  return mix(col, vec3(3.,2.8,2.4), smoothstep(.85, 1.1, k));
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float persp = 1.35 - p.y*.75;
  vec2 q = vec2(p.x, p.y + .1)/persp*3.2;
  float t = U[0].x;
  q.y += t*.06;
  vec2 w = q + .35*vec2(fbm(q*.7 + t*.05), fbm(q*.7 - t*.04 + 5.));
  vec4 v = voro(w*1.4);
  float crack = U[0].y;
  float edge = v.y;
  float glow = exp(-edge*(26. - 14.*crack));
  float wv = .6 + .8*noise(w*2.3 + 7.);
  float core = smoothstep((.03 + .09*crack)*wv, 0., edge);
  float crust = fbm(w*5. + v.zw);
  float cool = .1 + .15*sin(t*.3 + hash(v.zw)*6.);
  float k = max(core*(.75 + .3*crack), glow*.55) + cool*crust*.05;
  k += .15*fbm(q*2. - t*.2)*glow;
  // bolhas
  for(int i=0;i<6;i++){
    vec4 b = U[1+i];
    float a = U[0].z - b.z;
    if(a < 0. || a > 2.5 || b.w <= 0.) continue;
    vec2 bq = (q - b.xy);
    float d = length(bq);
    float grow = b.w*smoothstep(0., .5, a);
    float dome = smoothstep(grow, grow*.6, d)*step(a, .55);
    float ring = exp(-pow((d - b.w*(1. + a*1.6))*8., 2.))*smoothstep(.5, .6, a)*exp(-(a - .55)*2.);
    k += dome*(.55 + .4*(1. - d/max(grow,1e-3))) + ring*.7;
    k = max(k, smoothstep(b.w*.3, 0., d)*smoothstep(.45, .6, a)*exp(-(a - .6)*3.)*1.1);
  }
  k *= .85 + .3*B + .2*BEAT;
  k += .25*DROP;
  vec3 col = heat(clamp(k, 0., 1.2));
  col += (vivid(C3)*.05 + vec3(.03,.025,.025))*smoothstep(.3, .8, crust)*(1. - glow);
  float fog = smoothstep(-.1, .55, p.y);
  col = mix(col, heat(.35 + .2*B)*.6, fog*.55);
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const crack = new Envelope(0.05, 1.2);
    let clock = 30, next = 0;
    let first = true;
    return (u, _t, s, dt) => {
      if (first) {
        first = false;
        for (let i = 0; i < 6; i++) { const k = 4 + i * 4; u[k] = (Math.random() - 0.5) * 4; u[k + 1] = Math.random() * 3 + clock * 0.06; u[k + 2] = clock - Math.random() * 0.5; u[k + 3] = 0.15 + Math.random() * 0.2; }
      }
      clock += dt * (0.6 + 0.8 * s.energy);
      if (beat.hit(s)) {
        const k = 4 + next * 4;
        const y = Math.random() * 2.2;
        u[k] = (Math.random() - 0.5) * 3.2 * (1 + y * 0.3); u[k + 1] = y + clock * 0.06 - 0.6; u[k + 2] = clock; u[k + 3] = 0.12 + 0.25 * s.bass;
        next = (next + 1) % 6;
      }
      if (sec.hit(s) && sec.big) crack.kick(1);
      crack.step(Math.min(1, 0.15 + 0.6 * s.bass * s.sectionIntensity), dt);
      u[0] = clock; u[1] = crack.v; u[2] = clock;
    };
  },
});
