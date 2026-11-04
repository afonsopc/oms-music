/** Canos 3D (o protector de ecrã), em isométrico com sombreado de cilindro. */
import { canvasScene } from "../../lib/canvas";
import { rand } from "../../lib/random";

export default canvasScene({
  id: "pipes",
  name: "Canos",
  names: { en: "Pipes", lv: "Caurules" },
  families: ["retro"],
  tags: ["protector-de-ecrã", "3d"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "beat", "bar", "palette"],
  lyrics: "extrude",
}, () => {
  type Pipe = { x: number; y: number; z: number; dir: number; color: string; len: number };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const N = 14;
  let segs: { a: number[]; b: number[]; color: string; born: number }[] = [];
  let ps: Pipe[] = [];
  let acc = 0;
  let lastBar = -1;
  const reset = () => { segs = []; ps = []; };
  return {
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
});
