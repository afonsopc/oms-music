/**
 * Osciloscópio néon: a análise não traz a forma de onda, por isso a onda é
 * feita das quatro faixas (cada uma uma sinusóide na sua frequência) e
 * mexe-se com elas. Duas vistas que se alternam por compasso: linha e Lissajous.
 */
import { canvasScene } from "../../lib/canvas";

export default canvasScene({
  id: "scope",
  name: "Osciloscópio",
  names: { en: "Oscilloscope", lv: "Osciloskops" },
  families: ["retro"],
  tags: ["néon", "linhas", "aparelho"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "bar", "palette"],
  lyrics: "ascii",
}, () => ({
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
}));
