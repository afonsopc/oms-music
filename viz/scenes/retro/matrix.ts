/** Chuva ASCII de terminal: colunas de caracteres que caem mais depressa com a energia. */
import { canvasScene } from "../../lib/canvas";

export default canvasScene({
  id: "matrix",
  name: "Chuva de terminal",
  names: { en: "Terminal rain", lv: "Termināļa lietus" },
  families: ["retro", "chaos"],
  tags: ["terminal", "texto", "verde"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "beat", "title", "palette"],
  lyrics: "ascii",
}, () => {
  let drops: number[] = [];
  let cols = 0;
  const glyphs = "ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF<>/\\|=+*#%@♪♫OMS".split("");
  return {
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
});
