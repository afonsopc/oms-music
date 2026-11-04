/** As cenas desenhadas em Canvas 2D: canos, Mystify, estrelas, osciloscópio. */
import type { Canvas2DScene } from "./types";

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Canos 3D (o protector de ecrã), em isométrico com sombreado de cilindro. */
export const pipes = (): Canvas2DScene => {
  type Pipe = { x: number; y: number; z: number; dir: number; color: string; len: number };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const N = 14;
  let segs: { a: number[]; b: number[]; color: string; born: number }[] = [];
  let ps: Pipe[] = [];
  let acc = 0;
  let lastBar = -1;
  const reset = () => { segs = []; ps = []; };
  return {
    kind: "2d",
    reset,
    frame(ctx, w, h, dt, t, s, env) {
      const bar = Math.floor(s.bar / 2);
      if (bar !== lastBar && segs.length > 400) reset();
      lastBar = bar;
      if (ps.length === 0) ps = Array.from({ length: env.lowPower ? 2 : 4 }, (_, i) => ({ x: rand(-N, N) | 0, y: rand(-N, N) | 0, z: rand(-N, N) | 0, dir: (Math.random() * 6) | 0, color: env.colors[i % 3], len: 0 }));
      acc += dt * (6 + 30 * s.energy) * (1 + s.beat);
      while (acc > 1) {
        acc -= 1;
        for (const p of ps) {
          if (p.len > 2 && Math.random() < 0.25) p.dir = (Math.random() * 6) | 0;
          const d = DIRS[p.dir];
          const nx = p.x + d[0], ny = p.y + d[1], nz = p.z + d[2];
          if (Math.abs(nx) > N || Math.abs(ny) > N || Math.abs(nz) > N) { p.dir = (Math.random() * 6) | 0; p.len = 0; continue; }
          segs.push({ a: [p.x, p.y, p.z], b: [nx, ny, nz], color: p.color, born: t });
          p.x = nx; p.y = ny; p.z = nz; p.len++;
        }
      }
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const cell = Math.min(w, h) / (N * 2.6);
      const ang = t * 0.1;
      const proj = (v: number[]) => {
        const x = v[0] * Math.cos(ang) - v[2] * Math.sin(ang);
        const z = v[0] * Math.sin(ang) + v[2] * Math.cos(ang);
        return [w / 2 + (x - z) * cell * 0.87, h / 2 + (v[1] + (x + z) * 0.5) * cell * 0.87, x + z];
      };
      const sorted = segs.map((sg) => ({ sg, a: proj(sg.a), b: proj(sg.b) })).sort((m, n) => m.a[2] + m.b[2] - (n.a[2] + n.b[2]));
      const r = cell * (0.32 + 0.12 * s.bass);
      ctx.lineCap = "round";
      for (const { sg, a, b } of sorted) {
        const grad = ctx.createLinearGradient(a[0] - r, a[1] - r, a[0] + r, a[1] + r);
        grad.addColorStop(0, "#fff");
        grad.addColorStop(0.35, sg.color);
        grad.addColorStop(1, "#000");
        ctx.strokeStyle = grad;
        ctx.lineWidth = r * 2;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.fillStyle = sg.color;
        ctx.beginPath();
        ctx.arc(b[0], b[1], r * 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
};

/** Mystify: dois polígonos a ressaltar nas bordas, com rasto. */
export const mystify = (): Canvas2DScene => {
  type P = { x: number; y: number; vx: number; vy: number };
  let polys: { pts: P[]; trail: { x: number; y: number }[][] }[] = [];
  return {
    kind: "2d",
    reset: () => { polys = []; },
    frame(ctx, w, h, dt, _t, s, env) {
      if (polys.length === 0) polys = [0, 1].map(() => ({ pts: Array.from({ length: 4 }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-1, 1), vy: rand(-1, 1) })), trail: [] }));
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, w, h);
      const sp = (90 + 420 * s.energy) * (1 + 1.5 * s.beat) * dt;
      polys.forEach((poly, i) => {
        for (const p of poly.pts) {
          p.x += p.vx * sp; p.y += p.vy * sp;
          if (p.x < 0 || p.x > w) { p.vx *= -1; p.x = Math.max(0, Math.min(w, p.x)); }
          if (p.y < 0 || p.y > h) { p.vy *= -1; p.y = Math.max(0, Math.min(h, p.y)); }
        }
        poly.trail.unshift(poly.pts.map((p) => ({ x: p.x, y: p.y })));
        if (poly.trail.length > (env.lowPower ? 6 : 12)) poly.trail.pop();
        poly.trail.forEach((pts, k) => {
          ctx.strokeStyle = env.colors[(i + 1) % 3];
          ctx.globalAlpha = (1 - k / poly.trail.length) * (0.5 + 0.5 * s.energy);
          ctx.lineWidth = 2 + 3 * s.beat;
          ctx.beginPath();
          pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
        });
      });
      ctx.globalAlpha = 1;
    },
  };
};

/** Campo de estrelas em velocidade de dobra; os graves carregam no acelerador. */
export const starfield = (): Canvas2DScene => {
  let stars: { x: number; y: number; z: number; pz: number }[] = [];
  return {
    kind: "2d",
    reset: () => { stars = []; },
    frame(ctx, w, h, dt, _t, s, env) {
      const n = env.lowPower ? 350 : 900;
      while (stars.length < n) stars.push({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), pz: 1 });
      ctx.fillStyle = `rgba(0,0,0,${0.35 + 0.4 * (1 - s.energy)})`;
      ctx.fillRect(0, 0, w, h);
      const speed = (0.15 + 1.6 * s.bass + 2.5 * s.beat) * dt;
      const cx = w / 2, cy = h / 2, f = Math.min(w, h) * 0.5;
      ctx.lineCap = "round";
      for (const st of stars) {
        st.pz = st.z;
        st.z -= speed;
        if (st.z <= 0.02) { st.x = rand(-1, 1); st.y = rand(-1, 1); st.z = 1; st.pz = 1; continue; }
        const x = cx + (st.x / st.z) * f, y = cy + (st.y / st.z) * f;
        const px = cx + (st.x / st.pz) * f, py = cy + (st.y / st.pz) * f;
        ctx.strokeStyle = st.z < 0.3 ? "#fff" : env.colors[(st.x > 0 ? 1 : 2)];
        ctx.lineWidth = (1 - st.z) * 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
  };
};

/**
 * Osciloscópio néon: a análise não traz a forma de onda, por isso a onda é
 * feita das quatro faixas (cada uma uma sinusóide na sua frequência) e
 * mexe-se com elas. Duas vistas que se alternam por compasso: linha e Lissajous.
 */
export const scope = (): Canvas2DScene => ({
  kind: "2d",
  frame(ctx, w, h, _dt, t, s, env) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);
    const wave = (x: number) =>
      s.bass * Math.sin(x * 6 + t * 3) * 0.55 + s.lowmid * Math.sin(x * 19 - t * 5) * 0.3 + s.mid * Math.sin(x * 53 + t * 9) * 0.18 + s.high * Math.sin(x * 131 - t * 17) * 0.1;
    const neon = env.colors[1];
    ctx.shadowColor = neon;
    ctx.shadowBlur = 14 + 30 * s.beat;
    ctx.strokeStyle = neon;
    ctx.lineWidth = 2.5 + 2 * s.beat;
    ctx.beginPath();
    const lissa = Math.floor(s.bar) % 2 === 1;
    const steps = 600;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      let x: number, y: number;
      if (lissa) {
        const a = u * Math.PI * 2;
        x = w / 2 + Math.sin(a * 3 + t) * (0.25 + 0.15 * s.bass) * w + wave(u) * 40;
        y = h / 2 + Math.sin(a * 2) * (0.3 + 0.1 * s.mid) * h + wave(u + 0.3) * 40;
      } else {
        x = u * w;
        y = h / 2 + wave(u) * h * 0.38 * (0.6 + s.energy);
      }
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // grelha do ecrã do aparelho
    ctx.strokeStyle = "rgba(120,255,180,0.08)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += w / 10) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (let gy = 0; gy < h; gy += h / 8) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
  },
});
