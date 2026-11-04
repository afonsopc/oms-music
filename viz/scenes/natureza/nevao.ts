/**
 * Nevão: flocos de neve de seis pontas, cada um diferente, a cair e a rodar
 * à luz de um candeeiro nas cores da capa. Os de perto passam grandes e
 * desfocados, os de longe são pó. O vento sopra com os graves, os flocos
 * cintilam na batida e nas quedas vem uma tempestade de lado.
 */
import { Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "nevao",
  name: "Nevão",
  names: { en: "Snowfall", lv: "Sniegputenis" },
  families: ["calm"],
  tags: ["natureza", "inverno", "neve", "suave", "noite"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "high", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
float crystal(vec2 p, float r, float seed){
  float a = atan(p.y, p.x), d = length(p);
  a = mod(a, 1.0472) - .5236;
  vec2 q = vec2(cos(a), abs(sin(a)))*d;
  float s = abs(q.y) - r*.035;                    // braço
  float b1 = sd_seg(q, vec2(r*(.35 + .2*seed), 0.), vec2(r*(.55 + .2*seed), r*.18));
  float b2 = sd_seg(q, vec2(r*(.6 + .1*seed), 0.), vec2(r*.76, r*(.1 + .08*seed)));
  float f = max(s, d - r);
  f = min(f, min(b1, b2) - r*.03);
  f = min(f, d - r*(.1 + .1*seed));
  return f;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float wind = U[0].y, fall = U[0].x;
  // céu e candeeiro
  vec2 lamp = vec2(-.35, .62);
  vec3 lc = mix(vivid(C2), vec3(1., .9, .75), .35);
  vec3 col = mix(vivid(C3)*.06, vivid(C1)*.12, smoothstep(.5, -.5, p.y));
  float cone = smoothstep(.55, .0, abs(p.x - lamp.x + (p.y - lamp.y)*.05)/(lamp.y - p.y + .05)*.9);
  cone *= step(p.y, lamp.y);
  col += lc*cone*.22*(1. - smoothstep(-.6, .6, -p.y)*.4);
  col += lc*.9*exp(-length(p - lamp)*14.) + lc*.25*exp(-length(p - lamp)*4.);
  // chão de neve
  float gnd = -.38 + .03*sin(p.x*3.) + .02*noise(vec2(p.x*8., 0.));
  float g = smoothstep(gnd + .005, gnd - .005, p.y);
  col = mix(col, mix(vivid(C3)*.1, lc*.5, exp(-abs(p.x - lamp.x)*3.)*.8 + .1), g);
  // flocos em camadas, do fundo para a frente
  for(int l=0;l<6;l++){
    float fl = float(l);
    float depth = 1. + fl*.9;
    float sc = 22./depth*1.;
    float sz = 1./(depth*depth);
    vec2 q = p*(10./depth + 2.) ;
    q.x += wind*(1. + fl*.6) + sin(fall*.3 + fl)*.3;
    q.y += fall*(.8 + fl*.25) ;
    q.x += .25*sin(q.y*.7 + fl*3.);
    vec2 id = floor(q), f = fract(q) - .5;
    vec2 h = hash2(id + fl*31.);
    if(h.x < .25) continue;
    vec2 off = (h - .5)*.5;
    float r = .18 + .17*h.y;
    vec2 fp = (f - off)*rot(fall*(h.x - .5)*2. + h.y*6.);
    float dd;
    if(l >= 3) dd = crystal(fp, r, h.y);
    else dd = length(fp) - r*.35;
    float px = (10./depth + 2.)/R.y;
    float blur = px*1.5 + (l == 5 ? .06 : 0.);
    float m = smoothstep(blur, -blur, dd);
    vec2 world = (id + .5 + off)/(10./depth + 2.);
    float lit = .35 + 1.2*cone + .4*exp(-length(p - lamp)*3.);
    float glint = 1. + 1.8*BEAT*step(.7, h.y) + H*.5;
    col += m*lc*lit*glint*(.35 + .1*fl)*(l == 5 ? .55 : 1.);
  }
  col += U[0].z*vec3(.8,.85,1.)*.18;
  col *= 1. - .35*dot(p, p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const sec = new SectionEdge();
    const storm = new Envelope(0.3, 3);
    let fall = 0, wind = 0, w = 0;
    return (u, _t, s, dt) => {
      if (sec.hit(s) && sec.big) storm.kick(1);
      storm.step(s.section === "drop" || s.section === "high" ? 0.6 : 0, dt);
      const ws = 0.15 + 0.9 * s.bass * s.energy + 3.5 * storm.v;
      w += (ws - w) * Math.min(1, dt * 2);
      wind += dt * w;
      fall += dt * (0.25 + 0.35 * s.energy + 0.6 * storm.v);
      u[0] = fall; u[1] = wind; u[2] = s.drop;
    };
  },
});
