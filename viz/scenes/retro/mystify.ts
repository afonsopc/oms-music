/** Mystify: dois polígonos a ressaltar nas bordas, com rasto. */
import { canvasScene } from "../../lib/canvas";
import { rand } from "../../lib/random";

export default canvasScene({
  id: "mystify",
  name: "Mystify",
  names: { en: "Mystify", lv: "Mystify" },
  families: ["retro"],
  tags: ["protector-de-ecrã", "linhas"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "beat", "palette"],
  lyrics: "extrude",
}, () => {
  type P = { x: number; y: number; vx: number; vy: number };
  let polys: { pts: P[]; trail: { x: number; y: number }[][] }[] = [];
  return {
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
});
