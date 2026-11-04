/**
 * Flor: uma flor enorme vista de cima, com quatro coroas de pétalas nas
 * cores da capa. Fechada na intro, abre-se com a intensidade da secção e
 * abre de vez nas quedas, a largar pólen. Respira na batida; os estames do
 * meio acendem-se com os agudos. Em cada refrão novo a flor é outra.
 */
import { Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "flor",
  name: "Flor",
  names: { en: "Bloom", lv: "Zieds" },
  families: ["calm", "electronic"],
  tags: ["natureza", "flor", "suave", "primavera"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "high", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float open = U[0].x, spin = U[0].y, kind = U[0].z, burst = U[0].w;
  p *= 1. - .04*BEAT;
  float r = length(p), a = atan(p.y, p.x);
  // fundo: folhas escuras desfocadas
  vec3 col = vivid(C3)*.04 + vivid(C1)*.04*fbm(p*3. + T*.02);
  vec4 bk = voro(p*4. + vec2(T*.01, 0.));
  col += vivid(pal(hash(bk.zw)))*.06*smoothstep(.45, .2, bk.x)*step(.6, hash(bk.zw + 3.));
  col += vivid(C2)*.05*exp(-r*2.);
  float petalsN = 5. + floor(kind*4.);          // 5..8 pétalas
  for(int l=3;l>=0;l--){
    float fl = float(l);
    float n = petalsN + fl*3.;
    float o2 = clamp(open*1.25 - fl*.12, 0., 1.);
    float len = (.14 + .36*o2)*(1. - fl*.16) + .02*B;
    float aa = a + spin*(1. - fl*.3)*(l % 2 == 0 ? 1. : -1.) + fl*.4;
    float seg = 6.2832/n;
    float pa = mod(aa, seg) - seg*.5;
    float k = pa/(seg*.5);             // -1..1 através da pétala
    float notch = 1. - .12*exp(-k*k*60.)*step(.5, kind);
    float edge = len*pow(max(cos(k*1.45), 0.), .35 + kind*.9)*notch;
    // levantadas quando fechadas: encurtar no ecrã
    float lift = mix(.45, 1., o2);
    float rr = r/lift;
    float m = smoothstep(edge, edge - .006, rr)*smoothstep(.0, .02, rr);
    if(m > 0.){
      float u2 = rr/max(edge, 1e-3);
      vec3 pc = mix(vivid(C1), vivid(C2), u2*.8 + fl*.12);
      pc = mix(pc, vivid(C3), (1. - u2)*.35);
      float vein = .85 + .15*smoothstep(.0, .06, abs(k))*(.8 + .2*sin(u2*40.));
      float shade = .55 + .45*(1. - abs(k)) ;
      pc *= vein*shade*(.75 + .35*u2);
      pc += vec3(1.)*.12*pow(u2, 6.);
      col = mix(col*(.45 + .5*smoothstep(.0, .15, edge - rr)), pc, m);
    }
  }
  // o meio: estames
  float cr = .04 + .03*open;
  float cm = smoothstep(cr, cr - .004, r);
  vec3 cc = mix(vivid(C2)*.4, vivid(C1), .3);
  vec2 sp = p*rot(spin*.5)*60.;
  vec4 v = voro(sp);
  float dots = smoothstep(.35, .1, v.x);
  cc += mix(vivid(C2), vec3(1., .95, .7), .5)*dots*(.4 + .8*H + .5*BEAT);
  col = mix(col, cc, cm);
  col += vivid(C2)*.25*exp(-r*18.)*(.5 + H);
  // pólen solto na queda
  if(burst > .01){
    float br = (1. - burst)*.9 + .05;
    vec2 g = vec2(a*20., r*14.);
    vec2 id = floor(g);
    vec2 h = hash2(id);
    float d = length(fract(g) - .5 - (h - .5)*.6);
    float ring = smoothstep(.12, 0., abs(r - br*(0.6 + .6*h.x)))*smoothstep(.25, .1, d);
    col += mix(vivid(C2), vec3(1., .95, .7), .6)*ring*burst*2.;
  }
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const sec = new SectionEdge();
    const burst = new Envelope(0.01, 2.2);
    let open = 0.55, spin = 0, kind = 0.3, first = true;
    return (u, _t, s, dt) => {
      if (first) { first = false; open = 0.35 + 0.65 * s.sectionIntensity; kind = (s.sectionGroup * 0.37) % 1; }
      if (sec.hit(s)) {
        if (sec.big) { burst.v = 1; open = Math.min(open, 0.6); }
        kind = ((s.sectionGroup + 1) * 0.37) % 1;
      }
      const want = s.section === "drop" || s.section === "high" ? 1 : 0.2 + 0.75 * s.sectionIntensity;
      open += (want - open) * Math.min(1, dt * (s.drop > 0.3 ? 2.5 : 0.5));
      spin += dt * (0.04 + 0.12 * s.energy);
      burst.step(0, dt);
      u[0] = open; u[1] = spin; u[2] = kind; u[3] = burst.v;
    };
  },
});
