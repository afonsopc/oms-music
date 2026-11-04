/**
 * Mar à noite: alto mar, ondas de verdade (raymarching) com a lua nas
 * cores da capa e o rasto dela a brilhar na água. A energia levanta o mar,
 * os graves embalam a câmara, e na batida as cristas acendem-se com
 * plâncton bioluminescente. Nas quedas vem uma vaga enorme e o mar todo
 * brilha.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "mar-noite",
  name: "Mar à noite",
  names: { en: "Night sea", lv: "Nakts jūra" },
  families: ["calm", "electronic"],
  tags: ["natureza", "mar", "água", "noite", "3d"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, NAT_GLSL + `
float sea(vec2 x, int oct){
  float h = 0., a = U[0].y, f = .16, t = U[0].x;
  for(int i=0;i<6;i++){
    if(i >= oct) break;
    float fi = float(i);
    vec2 d = vec2(cos(fi*1.9 + .3), sin(fi*1.9 + .3));
    float ph = dot(d, x)*f + t*(1.1 + .25*fi) + fi*2.;
    ph += .6*noise(x*f*.5 + fi);
    float w = 1. - abs(sin(ph));
    h += a*(pow(w, 2.2)*1.6 - .6);
    a *= .5; f *= 2.;
  }
  return h;
}
vec3 skyCol(vec3 rd, vec3 md, bool clouds){
  float y = max(rd.y, 0.);
  vec3 c = mix(vivid(C1)*.16, vivid(C3)*.03, smoothstep(0., .5, y));
  float m = dot(rd, md);
  c += mix(vec3(1.), vivid(C2), .4)*smoothstep(.9994, .9996, m)*1.5;
  c += vivid(C2)*(.25*pow(max(m, 0.), 60.) + .08*pow(max(m, 0.), 6.));
  vec2 sp = floor(rd.xz/(rd.y + .2)*80.);
  c += step(.997, hash(sp))*smoothstep(.05, .3, y)*.7;
  if(!clouds) return c;
  float cl = fbm(rd.xz/(rd.y + .1)*1.5 + U[0].x*.02);
  c = mix(c, vivid(C3)*.03 + vivid(C2)*.1*pow(max(m, 0.), 8.), smoothstep(.55, .85, cl)*smoothstep(.0, .2, y)*.8);
  return c;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float bob = U[0].z;
  vec3 ro = vec3(0., 2.6 + bob*.8, U[0].x*1.5);
  vec3 rd = normalize(vec3(p.x, p.y - .06 + bob*.03, 1.2));
  rd.xy *= rot(bob*.04);
  vec3 md = normalize(vec3(.25, .22, 1.));
  vec3 col;
  if(rd.y > 0.){
    col = skyCol(rd, md, true);
  } else {
    float hmax = U[0].y*1.6;
    float t = (ro.y - hmax)/(-rd.y);
    vec3 q = ro + rd*t;
    for(int i=0;i<24;i++){
      float h = q.y - sea(q.xz, 3);
      if(h < .02*t*.02 || t > 120.) break;
      t += h*.9;
      q = ro + rd*t;
    }
    vec2 e = vec2(.06*(1. + t*.03), 0.);
    float h0 = sea(q.xz, 5);
    vec3 n = normalize(vec3(h0 - sea(q.xz + e.xy, 5), e.x, h0 - sea(q.xz + e.yx, 5)));
    vec3 rf = reflect(rd, n);
    rf.y = abs(rf.y);
    float fres = .04 + .96*pow(1. - max(dot(n, -rd), 0.), 5.);
    vec3 deep = vivid(C3)*.012 + vec3(.0,.008,.014);
    col = mix(deep, skyCol(rf, md, false), fres);
    col += mix(vec3(1.), vivid(C2), .4)*pow(max(dot(rf, md), 0.), 300.)*3.;
    float crest = smoothstep(.45, 1., (h0/max(U[0].y, .05))*.6 + .4);
    float bio = U[1].x;
    vec3 bc = mix(vec3(.1, 1., .85), vivid(C1), .5);
    col += bc*crest*(.08 + 1.4*bio)*(.6 + .4*noise(q.xz*3. + U[0].x))*exp(-t*.015);
    col = mix(col, vivid(C1)*.16 + vivid(C2)*.12*pow(max(dot(normalize(vec3(rd.x, .05, rd.z)), md), 0.), 6.), 1. - exp(-t*.012));
  }
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col*1.4), gl_FragCoord.xy), 1.);
}`, {
  scale: 0.6,
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const bio = new Envelope(0.02, 0.6);
    const swell = new Envelope(0.6, 3);
    let clock = 0, amp = 0.4, bob = 0;
    return (u, _t, s, dt) => {
      if (beat.hit(s)) bio.kick(0.25 + 0.6 * s.bass * s.sectionIntensity);
      if (sec.hit(s) && sec.big) { swell.kick(1); bio.kick(1); }
      bio.step(0, dt); swell.step(0, dt);
      clock += dt * (0.5 + 0.4 * s.energy + 0.4 * swell.v);
      const want = 0.25 + 0.4 * s.energy + 0.5 * swell.v;
      amp += (want - amp) * Math.min(1, dt * 0.8);
      bob = Math.sin(clock * 0.9) * (0.3 + 0.7 * s.bass) * (0.5 + amp);
      u[0] = clock; u[1] = amp; u[2] = bob; u[4] = bio.v;
    };
  },
});
