/**
 * Fluido (Navier-Stokes na GPU: advecção, vórtices, pressão): tinta nas
 * cores da capa injectada em jactos. Cada batida dispara um jacto de uma
 * borda, os graves fazem rodar dois injectores no centro, os ataques
 * salpicam, a queda rebenta uma estrela de oito jactos do meio.
 */
import { FIS_HEAD, gpuScene, Stepper, type Buf, type Pair } from "./_lib";
import { BeatEdge, SectionEdge, Trigger } from "../../lib/beat";

// P[i] = (x, y, dx, dy), P[i+4] = (r, g, b, raio): até 4 injecções
const SPLAT = (dye: boolean) => FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR;
  vec4 c = texture(S0, u);
  float a = R.x/R.y;
  for(int i=0;i<4;i++){
    vec4 s = P[i], k = P[i+4];
    if(k.w <= 0.) continue;
    vec2 d = (u - s.xy)*vec2(a,1.);
    float g = exp(-dot(d,d)/k.w);
    ${dye ? "c.rgb += k.rgb*g;" : "c.xy += s.zw*g;"}
  }
  o = ${dye ? "vec4(min(c.rgb, vec3(3.)), 1.)" : "c"};
}`;

const ADV = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR;
  vec2 v = texture(S1, u).xy;
  vec2 p = u - DT*v/P[0].xy;
  o = texture(S0, p)*P[0].z;
}`;

const CURL = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR, e = 1./SR;
  float c = texture(S0,u+vec2(e.x,0)).y - texture(S0,u-vec2(e.x,0)).y - texture(S0,u+vec2(0,e.y)).x + texture(S0,u-vec2(0,e.y)).x;
  o = vec4(.5*c,0.,0.,1.);
}`;

const VORT = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR, e = 1./SR;
  float l = texture(S1,u-vec2(e.x,0)).x, r = texture(S1,u+vec2(e.x,0)).x, b = texture(S1,u-vec2(0,e.y)).x, t = texture(S1,u+vec2(0,e.y)).x, c = texture(S1,u).x;
  vec2 f = vec2(abs(t)-abs(b), abs(r)-abs(l));
  f = f/(length(f)+1e-4)*P[0].w*c*vec2(1.,-1.);
  vec2 v = texture(S0,u).xy + f*DT;
  o = vec4(clamp(v, -900., 900.), 0., 1.);
}`;

const DIV = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR, e = 1./SR;
  float l = texture(S0,u-vec2(e.x,0)).x, r = texture(S0,u+vec2(e.x,0)).x, b = texture(S0,u-vec2(0,e.y)).y, t = texture(S0,u+vec2(0,e.y)).y;
  vec2 c = texture(S0,u).xy;
  if(u.x-e.x<0.) l = -c.x; if(u.x+e.x>1.) r = -c.x; if(u.y-e.y<0.) b = -c.y; if(u.y+e.y>1.) t = -c.y;
  o = vec4(.5*(r-l+t-b),0.,0.,1.);
}`;

const JAC = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR, e = 1./SR;
  float l = texture(S0,u-vec2(e.x,0)).x, r = texture(S0,u+vec2(e.x,0)).x, b = texture(S0,u-vec2(0,e.y)).x, t = texture(S0,u+vec2(0,e.y)).x;
  float d = texture(S1,u).x;
  o = vec4((l+r+b+t-d)*.25,0.,0.,1.);
}`;

const GRAD = FIS_HEAD + `
void main(){
  vec2 u = gl_FragCoord.xy/SR, e = 1./SR;
  float l = texture(S1,u-vec2(e.x,0)).x, r = texture(S1,u+vec2(e.x,0)).x, b = texture(S1,u-vec2(0,e.y)).x, t = texture(S1,u+vec2(0,e.y)).x;
  vec2 v = texture(S0,u).xy - .5*vec2(r-l, t-b);
  o = vec4(v,0.,1.);
}`;

const SCALE = FIS_HEAD + `
void main(){ o = texture(S0, gl_FragCoord.xy/SR)*P[0].x; }`;

const SHOW = FIS_HEAD + `
void main(){
  vec2 u = pixuv(uv), e = 1./SR*2.;
  vec3 d = texture(S0,u).rgb;
  float hx = lum(texture(S0,u+vec2(e.x,0)).rgb) - lum(texture(S0,u-vec2(e.x,0)).rgb);
  float hy = lum(texture(S0,u+vec2(0,e.y)).rgb) - lum(texture(S0,u-vec2(0,e.y)).rgb);
  vec3 n = normalize(vec3(-hx*2., -hy*2., 1.));
  float spec = pow(max(dot(reflect(normalize(vec3(.4,-.6,-.7)), n), vec3(0,0,1)),0.), 24.);
  vec3 bg = vivid(C1)*.05 + vec3(.01,.01,.02);
  vec3 c = bg + d*.9 + spec*min(lum(d),1.)*.5;
  vec2 p = uv-.5; c *= 1.-.4*dot(p,p);
  o = vec4(post(aces(c), gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "fluido",
  name: "Fluido",
  names: { en: "Fluid", lv: "Šķidrums" },
  families: ["calm", "chaos"],
  tags: ["tinta", "líquido", "simulação", "fumo"],
  intensity: 3,
  cost: 2,
  signals: ["bass", "beat", "onset", "drop", "section", "palette"],
  lyrics: "ink",
}, [SPLAT(false), SPLAT(true), ADV, CURL, VORT, DIV, JAC, GRAD, SCALE, SHOW], (g) => {
  const pv = g.full(SPLAT(false)), pd = g.full(SPLAT(true)), adv = g.full(ADV), curl = g.full(CURL), vort = g.full(VORT);
  const div = g.full(DIV), jac = g.full(JAC), grad = g.full(GRAD), scale = g.full(SCALE), show = g.full(SHOW);
  const st = new Stepper(60, 2, 90);
  const beat = new BeatEdge(1), sec = new SectionEdge(), on = new Trigger(0.6, 0.3);
  let vel: Pair | null = null, dye: Pair | null = null, prs: Pair | null = null, dv: Buf | null = null, cu: Buf | null = null;
  // injecções pendentes: x, y, dx, dy, cor (0..1 na paleta), raio
  const q = new Float32Array(16 * 6);
  let nq = 0, spin = 0, fade = 0, side = 0;
  const cv = [0, 0, 0];

  const add = (x: number, y: number, dx: number, dy: number, c: number, r: number) => {
    if (nq >= 16) return;
    const o = nq++ * 6;
    q[o] = x; q[o + 1] = y; q[o + 2] = dx; q[o + 3] = dy; q[o + 4] = c; q[o + 5] = r;
  };
  const colorAt = (t: number) => {
    const c = g.env.colorVecs;
    t = (t - Math.floor(t)) * 3;
    const i = Math.floor(t) % 3, k = t - Math.floor(t), a = c[i], b = c[(i + 1) % 3];
    for (let j = 0; j < 3; j++) cv[j] = a[j] + (b[j] - a[j]) * k;
    const l = 0.2126 * cv[0] + 0.7152 * cv[1] + 0.0722 * cv[2];
    const m = Math.max(1, 0.5 / Math.max(0.02, l));
    for (let j = 0; j < 3; j++) cv[j] = Math.min(1.5, (l + (cv[j] - l) * 1.5) * m);
  };
  const opening = () => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      add(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, -Math.cos(a + 0.6) * 220, -Math.sin(a + 0.6) * 220, i / 5, 0.004);
    }
  };
  const flush = () => {
    if (!vel || !dye) return;
    const P = g.P;
    while (nq > 0) {
      P.fill(0);
      const k = Math.min(4, nq);
      for (let i = 0; i < k; i++) {
        const o = (nq - 1 - i) * 6;
        P[i * 4] = q[o]; P[i * 4 + 1] = q[o + 1]; P[i * 4 + 2] = q[o + 2]; P[i * 4 + 3] = q[o + 3];
        colorAt(q[o + 4]);
        const r = q[o + 5];
        P[16 + i * 4] = cv[0] * 0.8; P[17 + i * 4] = cv[1] * 0.8; P[18 + i * 4] = cv[2] * 0.8; P[19 + i * 4] = r;
      }
      nq -= k;
      g.pass(pv, vel.write, vel.read); vel.swap();
      g.pass(pd, dye.write, dye.read); dye.swap();
    }
  };

  return {
    resize(w, h) {
      for (const b of [vel, dye, prs]) g.free(b);
      g.free(dv); g.free(cu);
      const vw = Math.max(32, Math.round(w / 8)), vh = Math.max(32, Math.round(h / 8));
      vel = g.pair(vw, vh, { linear: true }); prs = g.pair(vw, vh, { linear: true });
      dv = g.buf(vw, vh, { linear: true }); cu = g.buf(vw, vh, { linear: true });
      dye = g.pair(Math.max(64, Math.round(w / 2)), Math.max(64, Math.round(h / 2)), { linear: true });
      nq = 0;
      opening();
      st.reset();
    },
    song() { fade = 1; opening(); },
    frame(_g, f) {
      if (!vel || !dye || !prs || !dv || !cu) return;
      const s = g.s, P = g.P;
      if (beat.hit(s)) {
        side = (side + 1 + Math.floor(Math.random() * 3)) % 4;
        const t = 0.15 + 0.7 * Math.random(), sp = 300 + 500 * s.bass;
        const x = side === 0 ? 0.02 : side === 1 ? 0.98 : t, y = side === 2 ? 0.02 : side === 3 ? 0.98 : t;
        const ax = 0.5 - x + (Math.random() - 0.5) * 0.4, ay = 0.5 - y + (Math.random() - 0.5) * 0.4, al = Math.hypot(ax, ay) || 1;
        add(x, y, (ax / al) * sp, (ay / al) * sp, Math.random(), 0.0025 + 0.004 * s.bass);
      }
      if (on.hit(s.onset)) add(Math.random(), Math.random(), (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, Math.random(), 0.0012);
      if (sec.hit(s) && sec.big) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          add(0.5, 0.5, Math.cos(a) * 900, Math.sin(a) * 900, i / 8, 0.003);
        }
      }
      const n = st.n(f.dt, g.env);
      spin += f.dt * (0.6 + 2 * s.bass);
      for (let j = 0; j < n; j++) {
        g.dt = 1 / 60;
        if (s.bass > 0.25 && j === 0) {
          const r = 0.12 + 0.05 * s.bass;
          for (let k = 0; k < 2; k++) {
            const a = spin + k * Math.PI;
            add(0.5 + Math.cos(a) * r * 0.7, 0.5 + Math.sin(a) * r, -Math.sin(a) * 260 * s.bass, Math.cos(a) * 260 * s.bass, k * 0.5 + spin * 0.02, 0.0009 * s.bass);
          }
        }
        flush();
        P.fill(0);
        P[0] = vel.read.w; P[1] = vel.read.h; P[2] = 0.995; P[3] = 10 + 22 * s.mid;
        g.pass(curl, cu, vel.read);
        g.pass(vort, vel.write, vel.read, cu); vel.swap();
        g.pass(div, dv, vel.read);
        P[0] = 0.8;
        g.pass(scale, prs.write, prs.read); prs.swap();
        for (let i = 0; i < 18; i++) { g.pass(jac, prs.write, prs.read, dv); prs.swap(); }
        g.pass(grad, vel.write, vel.read, prs.read); vel.swap();
        P[0] = vel.read.w; P[1] = vel.read.h; P[2] = 0.992;
        g.pass(adv, vel.write, vel.read, vel.read); vel.swap();
        P[2] = fade > 0 ? 0.93 : 0.993 - 0.006 * s.energy;
        g.pass(adv, dye.write, dye.read, vel.read); dye.swap();
        fade = Math.max(0, fade - 1 / 45);
        g.tick();
      }
      g.dt = f.dt;
      g.pass(show, null, dye.read);
    },
  };
});
