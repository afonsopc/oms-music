/**
 * Trovoada: nuvens pesadas sobre uma planície, a chover de lado. Na batida
 * a nuvem acende-se por dentro aqui e ali; nas quedas e nos ataques fortes
 * um raio ramificado cai até ao chão e ilumina tudo nas cores da capa, e
 * o céu fica a tremer.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "trovoada",
  name: "Trovoada",
  names: { en: "Thunderstorm", lv: "Pērkona negaiss" },
  families: ["electronic", "chaos"],
  tags: ["natureza", "tempestade", "chuva", "escuro", "noite"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "beat", "onset", "drop", "section", "palette"],
  lyrics: "glitch",
}, NAT_GLSL + `
float bolt(vec2 p, float x0, float seed, float y1, out float glow){
  // um raio de cima (y=.55) até y1, aos ziguezagues, com dois ramos
  float d = 1e3;
  vec2 a = vec2(x0, .6);
  float br = 1e3;
  for(int i=0;i<14;i++){
    float fi = float(i);
    vec2 b = a + vec2((hash1(seed + fi*7.3) - .5)*.16, -(.6 - y1)/14.);
    float s = sd_seg(p, a, b);
    d = min(d, s);
    if(i == 4 || i == 8){
      vec2 c = b, e;
      for(int j=0;j<4;j++){
        e = c + vec2((hash1(seed + fi + float(j)*3.1) - .3)*.12*(i == 4 ? 1. : -1.), -.045);
        br = min(br, sd_seg(p, c, e));
        c = e;
      }
    }
    a = b;
  }
  glow = exp(-d*18.) + .4*exp(-br*30.);
  return min(d, br*1.6);
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float t = U[0].x;
  float fl = U[0].y;           // clarão do raio
  float bx = U[0].z, seed = U[0].w;
  float inner = U[1].x, ix = U[1].y;
  float rain = U[1].z;
  // nuvens: fbm em camadas, iluminadas por baixo e por dentro
  vec2 q = p*vec2(1., 1.6) + vec2(t*.04, 0.);
  float n = fbm(q*1.6 + vec2(0., t*.02)) ;
  float n2 = fbm(q*3.5 - vec2(t*.07, 0.) + n);
  float cloud = smoothstep(.35, .75, n*.7 + n2*.5 + p.y*.7);
  float bump = fbm(q*6. + n2*2. - vec2(t*.05, 0.));
  float dens = cloud*(.5 + .5*bump);
  vec3 dark = vivid(C3)*.03 + vec3(.008,.01,.016);
  vec3 rim = mix(vivid(C1), vec3(.5,.55,.65), .5)*.13;
  vec3 col = mix(vivid(C1)*.1 + dark, dark*.8 + rim*smoothstep(.3, .9, bump)*(1. - cloud*.5), cloud);
  col *= .7 + .6*smoothstep(.2, .8, n2);
  float near = exp(-length((p - vec2(ix, .25))*vec2(1., 1.5))*3.5);
  col += vivid(C2)*inner*near*(.4 + n2)*cloud*1.6;
  float glow = 0.;
  if(fl > .01){
    float d = bolt(p, bx, seed, -.36, glow);
    float core = smoothstep(.004, .0, d);
    vec3 lc = mix(vec3(.9,.92,1.), vivid(C2), .35);
    col += lc*(core*3. + glow*.8)*fl;
    col += lc*fl*(.25 + .9*cloud*exp(-abs(p.x - bx)*2.5))*.8;
  }
  // chão
  float gnd = -.36 + .03*fbm(vec2(p.x*3., 0.)) ;
  if(p.y < gnd){
    vec3 g = vivid(C3)*.02;
    g += mix(vec3(.9,.92,1.), vivid(C2), .35)*fl*.25*exp(-abs(p.x - bx)*2.);
    col = g + vivid(C1)*.02*(gnd - p.y);
  }
  // chuva de lado
  vec2 rq = p*vec2(1., .08) ;
  rq.x += p.y*.25;
  vec2 rp = vec2(rq.x*90., rq.y*90. + t*30.);
  float h = hash(floor(rp));
  float streak = step(1. - .13*rain, h)*smoothstep(.0, .5, fract(rp.y))*smoothstep(1., .5, fract(rp.y));
  col += streak*(.05 + .25*fl + .05*inner)*vec3(.7,.75,.85);
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const flash = new Envelope(0.005, 0.9);
    const inner = new Envelope(0.01, 0.25);
    let clock = 5, bx = 0.2, seed = 3, ix = 0, rain = 0.5, cool = 0;
    const strike = (k: number) => {
      bx = (Math.random() - 0.5) * 1.3; seed = Math.floor(Math.random() * 1000); flash.kick(k); cool = 0.6;
    };
    return (u, _t, s, dt) => {
      clock += dt * (0.6 + 0.8 * s.energy);
      cool -= dt;
      if (sec.hit(s) && sec.big) strike(1);
      else if (s.onset > 0.9 && cool < 0 && s.sectionIntensity > 0.6 && Math.random() < 0.25) strike(0.7);
      if (beat.hit(s)) { ix = (Math.random() - 0.5) * 1.4; inner.kick(0.35 + 0.65 * s.bass); }
      flash.step(0, dt); inner.step(0, dt);
      rain += (0.4 + 0.6 * s.sectionIntensity - rain) * Math.min(1, dt);
      // o raio pisca 2 ou 3 vezes antes de se apagar
      const f = flash.v * (flash.v > 0.5 ? 1 : 0.55 + 0.45 * Math.sign(Math.sin(flash.v * 40)));
      u[0] = clock; u[1] = Math.max(0, f); u[2] = bx; u[3] = seed;
      u[4] = inner.v; u[5] = ix; u[6] = rain;
    };
  },
});
