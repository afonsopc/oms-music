/**
 * Pirilampos: uma clareira ao anoitecer, erva alta a abanar e centenas de
 * pirilampos a vaguear. Acendem-se na batida, em quatro grupos que se
 * revezam (como os pirilampos que piscam em sincronia); com mais energia
 * acendem-se mais, cada um por si. Nas quedas uma onda de luz atravessa o
 * campo inteiro.
 */
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "pirilampos",
  name: "Pirilampos",
  names: { en: "Fireflies", lv: "Jāņtārpiņi" },
  families: ["calm"],
  tags: ["natureza", "noite", "verão", "suave", "partículas"],
  intensity: 1,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
float grass(vec2 p, float seed, float dens, float hmax, float wind){
  // lâminas de erva: uma por célula, curvadas pelo vento; distância mínima
  float d = 1e3;
  float cx = floor(p.x*dens);
  for(int k=-2;k<=2;k++){
    float id = cx + float(k);
    float h = hash1(id*1.7 + seed);
    float hh = hmax*(.35 + .65*h);
    float x0 = (id + .5 + (hash1(id + seed*3.) - .5)*.8)/dens;
    float y = p.y + .5;
    if(y > hh) continue;
    float f = y/hh;
    float bend = (wind*(.6 + .8*h) + .03*sin(T*1.3 + id))*f*f;
    float xc = x0 + bend;
    float wdt = (1. - f)*.0035*(1. + seed) + .0006;
    d = min(d, abs(p.x - xc) - wdt);
  }
  return d;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float asp = R.x/R.y;
  vec3 ff = mix(vec3(.8, 1., .35), vivid(C2), .55);
  // céu
  vec3 col = mix(vivid(C2)*.4, vivid(C3)*.07, smoothstep(-.25, .5, p.y));
  col = mix(col, vivid(C1)*.18, exp(-abs(p.y + .1)*5.)*.6);
  vec2 sp = floor(p*180.);
  col += step(.996, hash(sp))*smoothstep(.0, .3, p.y)*(.4 + .3*sin(T + hash(sp)*30.));
  // árvores ao longe
  float tl = -.08 + .06*fbm(vec2(p.x*2.5, 1.)) + .08*pow(noise(vec2(p.x*7., 3.)), 3.) + .015*noise(vec2(p.x*40., 0.));
  col = mix(col, vivid(C3)*.03, smoothstep(tl + .003, tl - .003, p.y));
  float tl2 = -.2 + .05*fbm(vec2(p.x*3.5 + 7., 2.)) + .1*pow(noise(vec2(p.x*5. + 3., 1.)), 4.);
  col = mix(col, vivid(C3)*.012, smoothstep(tl2 + .003, tl2 - .003, p.y));
  // pirilampos em três profundidades
  float glowSum = 0.;
  for(int l=0;l<3;l++){
    float fl = float(l);
    float sc = 9. - fl*2.5;
    vec2 q = p*sc + vec2(fl*17.3, fl*5.1);
    vec2 id0 = floor(q);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 id = id0 + vec2(i, j);
      vec2 h = hash2(id + fl*7.);
      if(h.y < .25) continue;
      vec2 c = id + .5 + .32*vec2(sin(T*(.3 + .3*h.x) + h.y*30.), cos(T*(.25 + .3*h.y) + h.x*20.));
      vec2 wp = c/sc - vec2(fl*17.3, fl*5.1)/sc;
      if(wp.y < -.45 || wp.y > .08 - .1*hash1(id.x)) continue;
      int g = int(floor(h.x*4.));
      float gl = g == 0 ? U[0].x : g == 1 ? U[0].y : g == 2 ? U[0].z : U[0].w;
      gl = gl*step(.3, fract(h.x*13.)) + U[1].x*pow(max(0., sin(T*(1.1 + h.y) + h.x*40.)), 30.);
      gl += U[1].z*exp(-pow((wp.x/asp + .5 - U[1].y)*7., 2.));
      gl = min(gl, 1.2);
      float d = length(q - c)/sc;
      float sz = (.006 + .004*fl);
      float a = .05 + .95*gl;
      col += ff*a*(smoothstep(sz, 0., d)*1.8 + .8*exp(-d/(sz*(3. + 3.*gl)))*gl*smoothstep(1.2/sc, .2/sc, d));
      glowSum += gl*(1. + fl);
    }
  }
  // erva à frente (duas camadas), iluminada de leve pelos pirilampos
  float wind = .02 + .05*B + .02*sin(T*.4);
  float g1 = grass(p, 1., 70., .26, wind*.7);
  col = mix(col, vivid(C3)*.04 + ff*.04*min(glowSum*.05, 2.), smoothstep(.0015, -.0015, g1));
  float g2 = grass(p, 2., 38., .36, wind);
  col = mix(col, vec3(.002,.004,.003), smoothstep(.002, -.002, g2));
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const g = new Float32Array([0.6, 0.2, 0.05, 0.35]);
    let beats = 0, wave = -1, waveK = 0;
    return (u, _t, s, dt) => {
      if (beat.hit(s)) { beats++; g[beats & 3] = 1; }
      if (sec.hit(s) && sec.big) { wave = -0.1; waveK = 1.2; }
      const fade = Math.exp(-dt * (1.8 + 1.5 * (1 - s.sectionIntensity)));
      for (let i = 0; i < 4; i++) { g[i] *= fade; u[i] = g[i]; }
      if (wave > -1) { wave += dt * 0.65; if (wave > 1.3) { wave = -1; waveK = 0; } }
      u[4] = 0.15 + 0.85 * s.energy * s.sectionIntensity; u[5] = wave; u[6] = waveK;
    };
  },
});
