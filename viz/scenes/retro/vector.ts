/** Vectores retro: um ecrã de fósforo com sólidos em arame a rodar e a pulsar. */
import { canvasScene } from "../../lib/canvas";

export default canvasScene({
  id: "vector",
  name: "Vectores",
  names: { en: "Vectors", lv: "Vektori" },
  families: ["retro"],
  tags: ["arcada", "arame", "3d"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "mid", "beat", "bar", "palette"],
  lyrics: "ascii",
}, () => {
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
});
