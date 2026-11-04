/**
 * Chuva no vidro: uma janela embaciada à noite, luzes da cidade desfocadas
 * nas cores da capa lá atrás. As gotas grandes escorrem aos solavancos com
 * os graves (cada batida dá-lhes um empurrão) e deixam um rasto limpo; cada
 * gota é uma lente que mostra as luzes ao contrário. Nas quedas, um
 * relâmpago ilumina tudo e a chuva aperta.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "chuva-vidro",
  name: "Chuva no vidro",
  names: { en: "Rain on glass", lv: "Lietus uz stikla" },
  families: ["calm", "electronic"],
  tags: ["natureza", "chuva", "noite", "suave", "lo-fi"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
vec3 bokeh(vec2 p, float soft){
  vec3 c = vec3(0.);
  for(int l=0;l<3;l++){
    float fl = float(l);
    float sc = 3.5 + fl*2.5;
    vec2 q = p*sc + vec2(fl*7.3 + T*.03*(fl+1.), fl*3.1);
    vec2 id = floor(q), f = fract(q)-.5;
    vec2 h = hash2(id + fl*13.);
    vec2 off = (h-.5)*.3;
    float r = .17 + .14*h.x;
    float d = length(f-off);
    float m = smoothstep(r, r*mix(.9,.2,soft), d) * step(.58, h.y);
    float tw = .7 + .3*sin(T*(.5+h.x) + h.y*30.);
    vec3 col = vivid(pal(h.x*.7 + h.y*.4 + fl*.2));
    c += col * m * (.3 + .5*h.y) * tw * (1. - fl*.22);
  }
  return c;
}
vec3 bg(vec2 p, float soft){
  float y = p.y + .5;
  vec3 c = mix(vivid(C1)*.22, vivid(C3)*.05, smoothstep(0., 1., y));
  c += vivid(C2)*.12*exp(-abs(y-.3)*6.);
  c += bokeh(p, soft) * (.7 + .5*B + .35*BEAT);
  c += U[0].y * mix(vec3(.85,.9,1.), vivid(C2), .3) * (.35 + .65*smoothstep(-.2, .6, p.y));
  return c;
}
vec3 runLayer(vec2 uv, float sc, float t, out float trail){
  vec2 g = vec2(14., 2.)*sc;
  vec2 st = uv*g;
  vec2 id = floor(st), c = fract(st);
  float n = hash(id + sc*17.);
  float ti = fract(t*(.16 + .12*n) + n*7.);
  float y = .92 - .84*(ti - sin(ti*18.85)/18.85);
  float xb = .5 + (n-.5)*.5;
  vec2 cs = vec2(R.x/R.y/g.x, 1./g.y);
  float r = .032/sc * (.8 + .4*n);
  float xp = xb + .07*sin(y*17. + n*40.)*sin(y*6.);
  vec2 q = (c - vec2(xp, y))*cs;
  q.y *= q.y > 0. ? .75 : 1.25;
  float life = smoothstep(1., .93, ti)*smoothstep(0., .04, ti)*step(.25, n);
  float m = smoothstep(r, r*.55, length(q)) * life;
  float xc = xb + .07*sin(c.y*17. + n*40.)*sin(c.y*6.);
  float dx = (c.x - xc)*cs.x;
  float above = step(y, c.y) * smoothstep(min(1., y + .7), y, c.y) * life;
  trail = smoothstep(r*.55, r*.15, abs(dx)) * above;
  float k = floor(c.y*14.);
  vec2 q2 = vec2(dx, (fract(c.y*14.) - .5)*cs.y/14.);
  float r2 = r*.38*hash(vec2(k, n));
  float m2 = smoothstep(r2, r2*.4, length(q2)) * above * step(.45, hash(vec2(n, k)));
  return vec3(q/r*m*.8 + q2/max(r2,1e-4)*m2*.35, max(m, m2));
}
vec3 staticDrops(vec2 uv, float t){
  vec2 p = uv*vec2(R.x/R.y, 1.)*26.;
  vec2 id = floor(p), f = fract(p) - .5;
  vec2 h = hash2(id);
  vec2 o = (h - .5)*.5;
  float life = fract(t*.07 + h.x*5.);
  float r = .1 + .2*h.y*h.y;
  float m = smoothstep(r, r*.5, length(f - o)) * smoothstep(1., .85, life) * smoothstep(0., .05, life) * step(.5, h.x);
  return vec3((f - o)/r*m, m);
}
void main(){
  vec2 p = pixuv(uv);
  vec2 asp = vec2(R.x/R.y, 1.);
  float ST = U[0].x;
  float t1, t2;
  vec3 d1 = runLayer(p, 1., ST, t1);
  vec3 d2 = runLayer(p + vec2(.37, .11), 1.8, ST*1.13 + 3., t2);
  vec3 sd = staticDrops(p, ST);
  float mask = max(max(d1.z, d2.z), sd.z);
  vec2 off = d1.xy + d2.xy + sd.xy;
  float clear = clamp(t1 + t2 + mask, 0., 1.);
  vec2 bp = (p - .5)*asp;
  vec3 back = bg(bp - off*.12*mask, mix(1., .15, clear));
  float fog = (1. - clear)*(.55 + .2*U[0].z);
  vec3 col = mix(back, back*.55 + vec3(lum(back))*.25 + vivid(C3)*.03, fog);
  col *= 1. - .45*smoothstep(.55, 1., length(off))*mask;
  col += mask*.08*vivid(C2) + pow(max(0., 1. - length(off - vec2(-.3,.4))), 8.)*mask*.5;
  col *= 1. - .35*dot(bp*.8, bp*.8);
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const flash = new Envelope(0.005, 0.35);
    let clock = 10, fogLift = 0;
    return (u, _t, s, dt) => {
      clock += dt * (0.35 + 1.1 * s.bass + 1.5 * s.drop);
      if (beat.hit(s)) clock += 0.05 + 0.12 * s.bass;
      if (sec.hit(s) && sec.big) flash.kick(1);
      if (s.onset > 0.95 && Math.random() < 0.04) flash.kick(0.5);
      flash.step(0, dt);
      fogLift += (s.sectionIntensity - fogLift) * Math.min(1, dt);
      // relâmpago com tremura (dois ou três clarões seguidos)
      const f = flash.v * (0.6 + 0.4 * Math.sin(clock * 90) * Math.sin(clock * 37));
      u[0] = clock; u[1] = Math.max(0, f); u[2] = 1 - fogLift;
    };
  },
});
