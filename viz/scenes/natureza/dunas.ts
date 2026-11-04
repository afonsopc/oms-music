/**
 * Dunas: um deserto em camadas, cristas afiadas com um lado ao sol e o outro
 * na sombra, e areia a voar das cristas com os graves. O sol (cor da capa)
 * sobe e desce com a intensidade da secção; nas quedas levanta-se uma
 * tempestade de areia que passa pelo ecrã.
 */
import { Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "dunas",
  name: "Dunas",
  names: { en: "Dunes", lv: "Kāpas" },
  families: ["calm", "electronic"],
  tags: ["natureza", "deserto", "quente", "vento", "suave"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, NAT_GLSL + `
float dune(float x, float seed){
  // barlavento suave, crista afiada, sotavento a pique
  float w = x*.45 + .35*sin(x*.31 + seed) + seed;
  float s = fract(w);
  float amp = .65 + .35*noise(vec2(floor(w), seed));
  float h = s < .72 ? 1. - pow(1. - s/.72, 2.) : pow(1. - (s - .72)/.28, 1.6);
  return h*amp*.7;
}
float duneD(float x, float seed){ return (dune(x + .01, seed) - dune(x - .01, seed))/.02; }
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float sunH = U[0].x, wind = U[0].y, storm = U[0].z, drift = U[0].w;
  vec2 sun = vec2(.45, -.05 + .45*sunH);
  vec3 sc = mix(vivid(C2), vec3(1., .85, .6), .4);
  // céu
  float sy = p.y;
  vec3 col = mix(vivid(C1)*.75, vivid(C3)*.3, smoothstep(-.2, .6, sy));
  col = mix(col, vivid(C3)*.08, smoothstep(.2, .6, sy)*(1. - sunH*.5));
  float sd = length(p - sun);
  col += sc*(smoothstep(.075, .07, sd)*1.6 + .5*exp(-sd*5.) + .25*exp(-sd*1.5))*(1. + .2*BEAT);
  // camadas de dunas, do fundo para a frente
  for(int l=0;l<5;l++){
    float fl = float(l);
    float sc2 = 1.4 - fl*.22;
    float base = .02 - fl*.12;
    float x = p.x*(1.5 + fl*.6) + drift*(.2 + fl*.35) + fl*13.;
    float h = base + dune(x, fl*3.7)*(.14 + fl*.05);
    if(p.y < h){
      float sl = duneD(x, fl*3.7)*(.14 + fl*.05)*(1.5 + fl*.6);
      float ndl = clamp((-sl*.9 + .35*(1. + sunH))/sqrt(1. + sl*sl), 0., 1.);
      vec3 sand = mix(vec3(.86,.58,.36), vivid(C1), .45);
      vec3 shade = mix(vivid(C3)*.3, sand*.25, .5);
      float depth = clamp((h - p.y)*6., 0., 1.);
      vec3 c = mix(shade, sand*(1.05 + .35*sunH), smoothstep(.05, .7, ndl));
      c *= 1. - .25*depth;
      c *= .94 + .06*sin(p.x*70.*(1. + fl*.4) + p.y*150. + noise(p*20.)*3.);
      float crest = exp(-(h - p.y)*90.);
      c += sc*crest*.35*smoothstep(.2, .8, ndl);
      c = mix(c, col, (1. - fl/4.)*.6);
      col = c;
    }
    float above = p.y - h;
    if(above > 0. && above < .12){
      float n = fbm(vec2(x*3. - wind*(2. + fl), above*25. - wind));
      float blow = smoothstep(.55, .9, n)*exp(-above*30.)*(.2 + B*.8 + storm);
      col += mix(vivid(C1), sc, .5)*blow*.35;
    }
  }
  // tempestade de areia
  if(storm > .01){
    float n = fbm(p*3. + vec2(-wind*1.5, 0.));
    float n2 = fbm(p*8. + vec2(-wind*3., n));
    col = mix(col, mix(vivid(C1), vivid(C2), .3)*(.5 + .6*n2), storm*smoothstep(.2, .8, n + n2*.4)*.85);
  }
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col*1.1), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const sec = new SectionEdge();
    const storm = new Envelope(0.5, 4);
    let sun = 0.5, wind = 0, drift = 0, first = true;
    return (u, _t, s, dt) => {
      if (first) { first = false; sun = s.sectionIntensity; }
      if (sec.hit(s) && sec.big) storm.kick(1);
      storm.step(0, dt);
      sun += (s.sectionIntensity - sun) * Math.min(1, dt * 0.4);
      wind += dt * (0.3 + 1.6 * s.bass + 3 * storm.v);
      drift += dt * (0.05 + 0.08 * s.energy + 0.4 * storm.v);
      u[0] = sun; u[1] = wind; u[2] = storm.v; u[3] = drift;
    };
  },
});
