/** 8-bit: um equalizador de blocos, um sprite que salta na batida, paleta de consola. */
import { canvasScene } from "../../lib/canvas";

export default canvasScene({
  id: "pixel8",
  name: "8 bits",
  names: { en: "8-bit", lv: "8 biti" },
  families: ["retro", "chaos"],
  tags: ["consola", "píxeis", "jogo"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "lowmid", "mid", "high", "beat", "palette"],
  lyrics: "glitch",
}, () => {
  let jump = 0;
  return {
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
});
