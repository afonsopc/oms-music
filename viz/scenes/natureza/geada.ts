/**
 * Geada: cristais de gelo a crescer num vidro, com a capa da música do
 * outro lado. Em cada compasso nasce um cristal novo; os graves fazem os
 * seis braços crescer e os ramos abrem-se a 60 graus, mais compridos perto
 * do centro, como a geada a sério. Cintilam na batida e com os agudos; nas
 * quedas o gelo derrete num clarão e começa tudo de novo.
 */
import { BarEdge, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

const K = 7;

export default natShader({
  id: "geada",
  name: "Geada",
  names: { en: "Frost", lv: "Sarma" },
  families: ["calm", "electronic"],
  tags: ["natureza", "inverno", "gelo", "capa", "suave"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "high", "beat", "bar", "drop", "section", "cover", "palette"],
  lyrics: "ink",
  artwork: "own",
}, NAT_GLSL + `
float arm(vec2 q, float r, float seed){
  // um braço ao longo de +x, com ramos a 60 graus que crescem com ele
  float d = sd_seg(q, vec2(0.), vec2(r, 0.));
  float sp = .035;
  float ay = abs(q.y);
  vec2 qa = vec2(q.x, ay);
  vec2 dir = vec2(.5, .866);
  float k0 = floor((q.x - ay*.577)/sp + .5);
  for(int j=-1;j<=1;j++){
    float k = k0 + float(j);
    float xb = k*sp;
    if(xb < sp*.5 || xb > r) continue;
    float L = (r - xb)*.5*(.55 + .45*hash1(k*7.1 + seed));
    vec2 b = vec2(xb, 0.);
    d = min(d, sd_seg(qa, b, b + dir*L));
    // ramos de terceira ordem, curtos
    float t2 = clamp(dot(qa - b, dir), 0., L);
    float s2 = floor(t2/(sp*.6) + .5)*sp*.6;
    if(s2 > .01 && s2 < L){
      vec2 c = b + dir*s2;
      d = min(d, sd_seg(qa, c, c + vec2((L - s2)*.35, 0.)));
    }
  }
  return d;
}
float crystal(vec2 p, vec4 c, float clock, out float halo){
  float age = clock - c.z;
  halo = 0.;
  if(age <= 0. || c.z < 0.) return 1e3;
  float r = min(.5, age*.08);
  vec2 q = p - c.xy;
  float l = length(q);
  if(l > r + .05) return 1e3;
  float a = atan(q.y, q.x) - c.w;
  a = mod(a, 1.0472) - .5236;
  vec2 s = vec2(cos(a), sin(a))*l;
  halo = smoothstep(r, 0., l);
  return arm(s, r, c.w*13.);
}
vec3 behind(vec2 q){
  // a capa por trás do vidro, a encher o ecrã
  float asp = R.x/R.y;
  vec2 c = (q - .5)*vec2(asp, 1.)*.75 + .5; c.y = 1. - c.y;
  vec3 a = texture(COVER, c).rgb + texture(COVER, c + vec2(.007, .002)).rgb + texture(COVER, c - vec2(.002, .007)).rgb;
  return a/3.;
}
void main(){
  vec2 q = pixuv(uv);
  vec2 p = (q - .5)*vec2(R.x/R.y, 1.);
  float clock = U[${K}].x, melt = U[${K}].y, flash = U[${K}].z;
  float d = 1e3, halo = 0., hk;
  int best = 0;
  for(int i=0;i<${K};i++){
    float di = crystal(p, U[i], clock, hk);
    halo = max(halo, hk);
    if(di < d){ d = di; best = i; }
  }
  float px = 1.5/R.y;
  float line = smoothstep(px*1.2, 0., d);
  float glow = exp(-d*140.);
  float vis = 1. - melt;
  float fog = smoothstep(.2, 1., fbm(p*3.5 + 2.) + U[${K}].w*.6 - .3)*U[${K}].w;
  float frost = (line*.9 + glow*.35 + halo*.12*(.6 + .4*fbm(p*25.)) + fog*.55*(.7 + .3*noise(p*90.)))*vis;
  vec3 bg = behind(q + vec2(glow, halo)*.01*vis);
  vec3 col = bg*(.38 - .12*halo*vis) + vivid(C3)*.03;
  vec3 iceC = mix(vec3(.85, .93, 1.), vivid(pal(float(best)*.21 + U[best].w*.1)), .4);
  col = mix(col, iceC + bg*.2, clamp(frost, 0., 1.));
  float tw = step(.992, hash(floor(gl_FragCoord.xy/2.) + floor(T*8.)))*line;
  col += tw*(.3 + 1.4*BEAT + H)*vis;
  col += flash*mix(vec3(1.), vivid(C2), .5)*.35;
  col *= 1. - .3*dot(p, p);
  o = vec4(post(col*1.1, gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const bar = new BarEdge();
    const sec = new SectionEdge();
    let clock = 0, next = 0, melt = 0, flash = 0, since = 0, first = true;
    const plant = (u: Float32Array, birth: number) => {
      const k = next * 4;
      u[k] = (Math.random() - 0.5) * 1.6; u[k + 1] = (Math.random() - 0.5) * 0.9; u[k + 2] = birth; u[k + 3] = Math.random() * 1.05;
      next = (next + 1) % K;
    };
    return (u, _t, s, dt) => {
      if (first) {
        first = false;
        // já com alguns cristais crescidos (o frame parado de "reduzir movimento" também)
        clock = 8;
        for (let i = 0; i < K; i++) plant(u, clock - 1.5 - i * 1.1);
      }
      clock += dt * (0.5 + 1.4 * s.bass + 0.8 * s.beat);
      since += dt;
      if (bar.hit(s) && melt <= 0) plant(u, clock);
      if ((sec.hit(s) && sec.big) || since > 60) { melt = 0.001; since = 0; flash = 1; }
      if (melt > 0) {
        melt += dt * 0.9;
        if (melt >= 1) { melt = 0; for (let i = 0; i < K; i++) u[i * 4 + 2] = -1; plant(u, clock); plant(u, clock - 1); }
      }
      flash *= Math.exp(-dt * 3);
      const o = K * 4;
      u[o] = clock; u[o + 1] = melt; u[o + 2] = flash; u[o + 3] = Math.min(1, 0.25 + since / 45);
    };
  },
});
