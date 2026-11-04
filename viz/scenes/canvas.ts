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
          pts.forEach((p, j) => {
            if (j) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          });
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
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
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

/** Chuva ASCII de terminal: colunas de caracteres que caem mais depressa com a energia. */
export const matrix = (): Canvas2DScene => {
  let drops: number[] = [];
  let cols = 0;
  const glyphs = "ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF<>/\\|=+*#%@♪♫OMS".split("");
  return {
    kind: "2d",
    reset: () => { drops = []; },
    frame(ctx, w, h, dt, _t, s, env) {
      const size = Math.max(12, Math.round(w / 70));
      if (cols !== Math.ceil(w / size) || drops.length === 0) {
        cols = Math.ceil(w / size);
        drops = Array.from({ length: cols }, () => Math.random() * -h / size);
      }
      ctx.fillStyle = `rgba(0,0,0,${0.08 + 0.1 * (1 - s.energy)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${size}px ui-monospace,Menlo,monospace`;
      const speed = (8 + 40 * s.energy + 30 * s.beat) * dt;
      for (let i = 0; i < cols; i++) {
        const y = drops[i] * size;
        ctx.fillStyle = Math.random() < 0.06 ? "#fff" : i % 7 === 0 ? env.colors[1] : "#3dff8a";
        ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, y);
        drops[i] += speed * (0.6 + ((i * 7919) % 10) / 20);
        if (y > h && Math.random() > 0.97) drops[i] = Math.random() * -20;
      }
      if (s.beat > 0.9 && env.title) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${size * 2}px ui-monospace,Menlo,monospace`;
        ctx.fillText(`> ${env.title}_`, size, h / 2);
      }
    },
  };
};

/** Vectores retro: um ecrã de fósforo com sólidos em arame a rodar e a pulsar. */
export const vector = (): Canvas2DScene => {
  const cube = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const cubeE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const t1 = (Math.sqrt(5) + 1) / 2;
  const ico = [[-1, t1, 0], [1, t1, 0], [-1, -t1, 0], [1, -t1, 0], [0, -1, t1], [0, 1, t1], [0, -1, -t1], [0, 1, -t1], [t1, 0, -1], [t1, 0, 1], [-t1, 0, -1], [-t1, 0, 1]];
  const icoE: number[][] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const d = Math.hypot(ico[i][0] - ico[j][0], ico[i][1] - ico[j][1], ico[i][2] - ico[j][2]);
    if (Math.abs(d - 2) < 0.01) icoE.push([i, j]);
  }
  return {
    kind: "2d",
    frame(ctx, w, h, _dt, t, s, env) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, w, h);
      const shapes = [{ v: cube, e: cubeE, x: 0.3, k: 1 }, { v: ico, e: icoE, x: 0.7, k: 0.6 }];
      ctx.lineWidth = 2;
      ctx.shadowBlur = 12 + 20 * s.beat;
      for (const sh of shapes) {
        const ay = t * 0.7 + s.bar * 0.3, ax = t * 0.4;
        const sc = Math.min(w, h) * 0.18 * sh.k * (1 + 0.25 * s.beat + 0.15 * s.bass);
        const pts = sh.v.map(([x, y, z]) => {
          let X = x * Math.cos(ay) - z * Math.sin(ay); let Z = x * Math.sin(ay) + z * Math.cos(ay);
          const Y = y * Math.cos(ax) - Z * Math.sin(ax); Z = y * Math.sin(ax) + Z * Math.cos(ax);
          const f = 3.5 / (3.5 + Z);
          X *= f;
          return [w * sh.x + X * sc, h / 2 + Y * f * sc];
        });
        ctx.strokeStyle = sh.k === 1 ? "#7dffb0" : env.colors[1];
        ctx.shadowColor = ctx.strokeStyle;
        ctx.beginPath();
        for (const [a, b] of sh.e) { ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); }
        ctx.stroke();
      }
      // horizonte de montanhas vectoriais, como os jogos de arcada
      ctx.strokeStyle = "#7dffb0";
      ctx.beginPath();
      for (let x = 0; x <= w; x += w / 40) {
        const y = h * 0.85 - Math.abs(Math.sin(x * 0.01 + t * 0.5)) * h * 0.08 * (0.5 + s.mid);
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    },
  };
};

/** 8-bit: um equalizador de blocos, um sprite que salta na batida, paleta de consola. */
export const pixel8 = (): Canvas2DScene => {
  let jump = 0;
  return {
    kind: "2d",
    frame(ctx, w, h, dt, t, s, env) {
      const px = Math.max(6, Math.round(Math.min(w, h) / 60));
      const cols = Math.floor(w / px), rows = Math.floor(h / px);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#0f0f23";
      ctx.fillRect(0, 0, w, h);
      // estrelas de píxel
      for (let i = 0; i < 40; i++) {
        const x = ((i * 97 + Math.floor(t * 8) * (i % 3)) % cols) * px, y = ((i * 53) % Math.floor(rows * 0.5)) * px;
        ctx.fillStyle = i % 2 ? "#5a5a8a" : "#fff";
        ctx.fillRect(x, y, px, px);
      }
      // equalizador
      const bands = [s.bass, s.lowmid, s.mid, s.high];
      const bars = 16, bw = Math.floor(cols / bars);
      for (let b = 0; b < bars; b++) {
        const level = bands[b % 4] * (0.6 + 0.4 * Math.sin(b * 1.7 + t * 3)) + s.beat * 0.2;
        const hgt = Math.round(level * rows * 0.45);
        for (let y = 0; y < hgt; y++) {
          ctx.fillStyle = y > rows * 0.35 ? "#ff3b6b" : y > rows * 0.2 ? "#ffd23b" : env.colors[2];
          ctx.fillRect(b * bw * px + px, (rows - 2 - y) * px, (bw - 1) * px, px - 1);
        }
      }
      // o sprite: uma nota musical que salta
      if (s.beat > 0.95) jump = 1;
      jump = Math.max(0, jump - dt * 2.5);
      const sy = rows * 0.4 - Math.sin(jump * Math.PI) * rows * 0.15;
      const sprite = ["..XXXX", "..X..X", "..X..X", "XXX.XXX", "XXX.XXX"];
      sprite.forEach((row, ry) => row.split("").forEach((c, rx) => {
        if (c === "X") { ctx.fillStyle = "#fff"; ctx.fillRect((cols / 2 - 3 + rx) * px, (sy + ry) * px, px, px); }
      }));
    },
  };
};
