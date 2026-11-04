/**
 * Vidro estilhaçado: a capa atrás de um vidro. Cada batida estala-o mais um
 * anel à volta do ponto de impacto (as fendas brilham e entortam a imagem);
 * na queda, ou quando já não aguenta, rebenta: 126 estilhaços em 3D a voar
 * para nós a rodar, com a capa em cada um, e depois o filme anda para trás e
 * o vidro volta a ficar inteiro, com o impacto noutro sítio. As fatias são
 * feitas no vertex shader a partir do número do vértice (sem geometria).
 */
import { FIS_HEAD, gpuScene, VHEAD } from "./_lib";
import { BeatEdge, SectionEdge } from "../../lib/beat";

const K = 18, RN = 7, NS = K * RN;

const VS = VHEAD + `
out vec2 orig, st;
out vec3 nrm;
flat out float ring;
vec2 gp(int a, int r){
  a = a % ${K};
  if(r == 0) return vec2(0.);
  float ang = (float(a) + .5*(hash11(float(a*31 + r*7) + P[1].z) - .5))/${K}.*6.28318;
  float rad = .05*pow(1.85, float(r - 1))*(1. + .3*(hash11(float(a*13 + r*101) + P[1].z*1.3) - .5));
  return vec2(cos(ang), sin(ang))*rad;
}
mat3 rotAxis(vec3 a, float t){
  float c = cos(t), s = sin(t), k = 1. - c;
  return mat3(c + a.x*a.x*k, a.y*a.x*k + a.z*s, a.z*a.x*k - a.y*s,
              a.x*a.y*k - a.z*s, c + a.y*a.y*k, a.z*a.y*k + a.x*s,
              a.x*a.z*k + a.y*s, a.y*a.z*k - a.x*s, c + a.z*a.z*k);
}
void main(){
  int sh = gl_VertexID / 6, v = gl_VertexID % 6;
  int a = sh % ${K}, r = sh / ${K};
  ivec2 o = v == 0 ? ivec2(0,0) : v == 1 ? ivec2(1,0) : v == 2 ? ivec2(0,1) : v == 3 ? ivec2(1,0) : v == 4 ? ivec2(1,1) : ivec2(0,1);
  vec2 c00 = gp(a, r), c10 = gp(a+1, r), c01 = gp(a, r+1), c11 = gp(a+1, r+1);
  vec2 p = o == ivec2(0,0) ? c00 : o == ivec2(1,0) ? c10 : o == ivec2(0,1) ? c01 : c11;
  vec2 cc = (c00 + c10 + c01 + c11)*.25;
  vec2 imp = P[1].xy;
  orig = imp + p;
  st = vec2(o);
  ring = float(r);
  float tau = P[0].x;
  float s = float(sh);
  vec3 rnd = vec3(hash11(s*1.1), hash11(s*2.3 + 4.), hash11(s*3.7 + 9.));
  vec2 dir = normalize(cc + vec2(1e-4));
  float near = 1./(.25 + length(cc)*2.);
  vec3 vel = vec3(dir*(.15 + .5*rnd.x)*near, (.5 + 1.2*rnd.y)*near);
  vec3 axis = normalize(rnd*2. - 1. + vec3(0.,0.,.01));
  mat3 M = rotAxis(axis, (3. + 8.*rnd.z)*tau*near);
  vec3 w = vec3(imp + cc, 0.) + vel*tau + vec3(0., -.5, 0.)*tau*tau + M*vec3(p - cc, 0.);
  // vibração dos graves no vidro inteiro
  w.z += .004*sin(T*40. + length(orig)*30.)*B*(1. - min(tau*4., 1.));
  nrm = M*vec3(0,0,1);
  float F = 1.6, asp = R.x/R.y;
  float wd = F - w.z;
  gl_Position = vec4(w.x/(asp*.5)*F, w.y/.5*F, (wd - F)*wd*.2, wd);
  uv = vec2(0.);
}`;

const FS = FIS_HEAD + `
in vec2 orig, st;
in vec3 nrm;
flat in float ring;
vec3 content(vec2 q){
  vec2 cu = q/.92 + .5;
  vec3 c = mix(vivid(C1)*.18, vivid(C2)*.08, q.y + .5) + .03*noise(q*40.);
  if(cu.x > 0. && cu.x < 1. && cu.y > 0. && cu.y < 1.) c = texture(COVER, vec2(cu.x, 1. - cu.y)).rgb;
  return c;
}
void main(){
  float e = min(min(st.x, 1. - st.x), min(st.y, 1. - st.y));
  float fw = fwidth(e);
  bool cracked = ring < P[0].y;
  float line = cracked ? smoothstep(fw*2.2, 0., e) : 0.;
  // perto da fenda, a imagem entorta (refracção)
  vec2 off = cracked ? (st - .5)*.006*smoothstep(fw*8., 0., e) : vec2(0.);
  vec3 c = content(orig + off);
  vec3 n = normalize(nrm);
  float flying = step(.001, P[0].x);
  c *= mix(1., .55 + .45*abs(n.z), flying);
  c += vec3(.9)*line*(.55 + .45*BEAT);
  c += vec3(1.)*pow(1. - abs(n.z), 6.)*flying*.6;
  // uma película de vidro por cima de tudo
  c += vec3(.06)*smoothstep(.0, 1., orig.y + .5)*(1. - flying*.5);
  c = mix(c, vec3(1.), P[0].z);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

const BG = FIS_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 c = vivid(C3)*.08*smoothstep(1., 0., length(p)) + .01;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "vidro",
  name: "Vidro estilhaçado",
  names: { en: "Shattered glass", lv: "Saplīsis stikls" },
  families: ["chaos"],
  tags: ["capa", "3d", "brutal", "explosão", "vidro"],
  intensity: 5,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "cover", "palette"],
  lyrics: "glitch",
  artwork: "own",
}, [BG], (g) => {
  const bg = g.full(BG), glass = g.custom(VS, FS);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  let crack = 0, tau = 0, phase = 0, flash = 0, ix = 0, iy = 0, seed = 0;
  // phase: 0 inteiro, 1 a voar, 2 a voltar para trás
  const shatter = () => { if (phase === 0) { phase = 1; tau = 0; flash = 0.7; } };
  const moveImpact = () => { ix = (Math.random() - 0.5) * 0.5; iy = (Math.random() - 0.5) * 0.4; seed = Math.random() * 40; };

  return {
    song() { phase = 2; crack = 0; },
    frame(_g, f) {
      const s = g.s, P = g.P, gl = g.gl;
      const dt = g.env.reduceMotion ? 0 : Math.min(0.05, f.dt);
      if (g.env.reduceMotion) crack = 4;
      if (beat.hit(s) && phase === 0) { crack += 1; if (crack > RN + 1) shatter(); }
      if (sec.hit(s) && sec.big) { crack = RN; shatter(); }
      if (phase === 1) { tau += dt; if (tau > 1.7) phase = 2; }
      else if (phase === 2) { tau -= dt * 2.4; if (tau <= 0) { tau = 0; phase = 0; crack = 0; moveImpact(); } }
      flash *= Math.exp(-dt * 9);
      P.fill(0);
      // a voltar: ease (mais devagar no fim, como um filme a parar)
      P[0] = phase === 2 ? tau * tau / 1.7 : tau; P[1] = crack; P[2] = flash;
      P[4] = ix; P[5] = iy; P[6] = seed;
      g.pass(bg, null);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      g.draw(glass, null, gl.TRIANGLES, NS * 6, null, null, null);
      gl.disable(gl.DEPTH_TEST);
    },
  };
});
