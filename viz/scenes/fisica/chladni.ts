/**
 * Cimática (figuras de Chladni): uma placa de metal a vibrar e 65 mil grãos
 * de areia na GPU a fugir das zonas que tremem para as linhas paradas. O
 * modo de vibração muda a cada dois compassos (e salta para os agudos nos
 * refrões), os graves dão a força, as batidas fazem a areia saltar e a
 * queda atira-a toda ao ar antes de cair no desenho novo.
 */
import { FIS_HEAD, gpuScene, Stepper, VHEAD, type Pair } from "./_lib";
import { BarEdge, isPeak, SectionEdge } from "../../lib/beat";

const N = 256; // 256 x 256 grãos

const CHL = `
float chl(vec2 p, vec2 nm){ p = p*.5+.5; float n=nm.x, m=nm.y;
  return cos(n*3.14159*p.x)*cos(m*3.14159*p.y) - cos(m*3.14159*p.x)*cos(n*3.14159*p.y); }
float plate(vec2 p){ return mix(chl(p, P[0].xy), chl(p, P[0].zw), P[1].x); }
`;

const SIM = FIS_HEAD + CHL + `
void main(){
  vec2 id = gl_FragCoord.xy;
  vec4 s = texelFetch(S0, ivec2(id), 0);
  vec2 p = s.xy, v = s.zw;
  if(P[2].x > 0. || STEP < 1.){ p = hash22(id*1.37 + P[2].y)*2.-1.; v = vec2(0.); }
  float e = .004;
  float a = plate(p);
  vec2 gr = vec2(plate(p+vec2(e,0))*plate(p+vec2(e,0)) - plate(p-vec2(e,0))*plate(p-vec2(e,0)),
                 plate(p+vec2(0,e))*plate(p+vec2(0,e)) - plate(p-vec2(0,e))*plate(p-vec2(0,e)))/(2.*e);
  vec2 j = hash22(id + fract(STEP*.6180339)*917.)*2.-1.;
  float amp = P[1].y;
  v = v*.75 - gr*.0012 + j*abs(a)*amp*.006 + j*P[1].z*.012;
  p += v;
  if(abs(p.x) > 1.){ p.x = sign(p.x)*(2.-abs(p.x)); v.x = -v.x*.5; }
  if(abs(p.y) > 1.){ p.y = sign(p.y)*(2.-abs(p.y)); v.y = -v.y*.5; }
  p = clamp(p, -1., 1.);
  o = vec4(p, v);
}`;

const VS = VHEAD + `
out vec3 col;
void main(){
  int i = gl_VertexID;
  vec4 s = texelFetch(S0, ivec2(i % ${N}, i / ${N}), 0);
  float k = P[3].x; // meia altura da placa em clip
  vec2 q = s.xy*k*vec2(R.y/R.x, 1.);
  gl_Position = vec4(q, 0., 1.);
  float sp = length(s.zw)*120.;
  gl_PointSize = P[3].y*(1. + .6*min(sp, 2.));
  vec3 c = vivid(pal(hash11(float(i))*.35 + length(s.xy)*.4 + T*.02));
  col = mix(c, vec3(1.), clamp(sp*.6, 0., 1.))*(.3 + .25*BEAT);
  uv = vec2(0.);
}`;

const FS = FIS_HEAD + `
in vec3 col;
void main(){ vec2 d = gl_PointCoord-.5; o = vec4(col*smoothstep(.5,.1,length(d)), 1.); }`;

const PLATE = FIS_HEAD + CHL + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.)*2./P[3].x;
  vec2 a = abs(p);
  float inside = smoothstep(1.02, 1., max(a.x,a.y));
  float rim = smoothstep(1.06, 1.0, max(a.x,a.y)) - inside;
  float vib = abs(plate(clamp(p,-1.,1.)));
  vec3 metal = mix(vec3(.05,.05,.06), vivid(C1)*.12, .6) * (1. - .25*length(p));
  metal += vec3(.04)*pow(max(0., 1.-abs(p.x+p.y)*.6), 6.);
  vec3 c = metal*inside + vivid(C2)*vib*vib*inside*.012*(1. + 2.*P[1].y);
  c += rim*vec3(.25)*(.6 + .8*BEAT);
  c += vec3(.008)*(1.-inside);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

// modos (n, m) com figuras bonitas, do mais simples ao mais denso
const MODES = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7], [1, 6], [4, 7], [5, 6], [3, 8], [5, 8], [6, 7]];

export default gpuScene({
  id: "chladni",
  name: "Cimática",
  names: { en: "Cymatics", lv: "Kimatika" },
  families: ["calm", "retro"],
  tags: ["areia", "som", "geométrico", "partículas", "simulação"],
  intensity: 2,
  cost: 2,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "extrude",
}, [SIM, PLATE], (g) => {
  const sim = g.full(SIM), plate = g.full(PLATE), pts = g.custom(VS, FS);
  const st = new Stepper(60, 3, 240);
  const bar = new BarEdge(2), sec = new SectionEdge();
  let field: Pair | null = null;
  let a = 0, b = 1, mix = 1, reset = 1, throwV = 0, hop = 0;
  const pick = (hi: boolean) => {
    a = b;
    const lo = hi ? 8 : 0, n = hi ? MODES.length - 8 : 9;
    let nb = lo + Math.floor(Math.random() * n);
    if (nb === a) nb = (nb + 1) % MODES.length;
    b = nb;
    mix = 0;
  };
  return {
    resize() {
      g.free(field);
      field = g.pair(N, N, { fmt: "f32" });
      reset = 1;
      st.reset();
    },
    song() { pick(false); throwV = 1; },
    frame(_g, f) {
      if (!field) return;
      const s = g.s, P = g.P;
      if (sec.hit(s)) { pick(isPeak(s)); if (sec.big) throwV = 2; }
      else if (bar.hit(s)) pick(isPeak(s));
      if (s.beat > 0.9) hop = Math.max(hop, 0.25 + 0.5 * s.bass);
      mix = Math.min(1, mix + f.dt * 1.5);
      const n = st.n(f.dt, g.env);
      const k = Math.min(0.92, 0.92 * (g.h / g.w) * (g.w / g.h)) ;
      for (let i = 0; i < n; i++) {
        P.fill(0);
        P[0] = MODES[a][0]; P[1] = MODES[a][1]; P[2] = MODES[b][0]; P[3] = MODES[b][1];
        P[4] = mix * mix * (3 - 2 * mix); P[5] = 0.5 + 1.8 * s.bass + 0.6 * s.energy; P[6] = throwV + hop;
        P[8] = reset; P[9] = Math.random() * 100;
        P[12] = k;
        g.pass(sim, field.write, field.read);
        field.swap();
        g.tick();
        reset = 0;
        throwV *= 0.9;
        hop *= 0.85;
      }
      P[12] = k; P[13] = Math.max(1.2, g.h / 520);
      g.pass(plate, null);
      g.draw(pts, null, g.gl.POINTS, g.env.lowPower ? (N * N) >> 1 : N * N, field.read, null, "add");
    },
  };
});
