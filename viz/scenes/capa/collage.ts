/**
 * Colagem (inspirada no visualizador do cobaltforever para "gecgecgec
 * (remix)", que o dono adora; nada copiado, só o espírito): uma parede do
 * título em letra larga a preto e branco a escorregar, a capa recortada em
 * caixilho a saltar pelo ecrã, a letra enorme em maiúsculas sobre um fundo
 * quente e granulado, e planos pretos com a capa pequena e escura quando a
 * música acalma. Corta a seco: nas batidas fortes e no compasso.
 */
import { canvasScene } from "../../lib/canvas";

export default canvasScene({
  id: "collage",
  name: "Colagem",
  names: { en: "Collage", lv: "Kolāža" },
  families: ["chaos"],
  tags: ["capa", "texto", "letra", "preto-e-branco"],
  intensity: 5,
  cost: 1,
  signals: ["energy", "beat", "bar", "onset", "cover", "title", "lyric", "palette"],
  lyrics: "own",
}, () => {
  type Shot = "wall" | "card" | "dark";
  let shot: Shot = "wall";
  let lastBar = -1;
  let lastBeat = -1;
  let offset = 0;
  let invert = false;
  let sticker = { x: 0.6, y: 0.3, s: 0.4, r: -0.05 };
  const grain = document.createElement("canvas");
  grain.width = grain.height = 128;
  const gctx = grain.getContext("2d")!;
  const img = gctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 40;
  }
  gctx.putImageData(img, 0, 0);
  const cut = (s: { energy: number }, lyric: string) => {
    if (s.energy < 0.3) shot = "dark";
    else if (lyric && shot !== "card" && Math.random() < 0.55) shot = "card";
    else shot = shot === "wall" ? (lyric ? "card" : "wall") : "wall";
    sticker = { x: 0.15 + Math.random() * 0.6, y: 0.1 + Math.random() * 0.5, s: 0.3 + Math.random() * 0.18, r: (Math.random() - 0.5) * 0.2 };
  };
  return {
    reset: () => { lastBar = -1; },
    frame(ctx, w, h, dt, t, s, env) {
      const lyric = (env.lyric ?? "").trim();
      const bar = Math.floor(s.bar);
      const beat = Math.floor(s.beatPos);
      if (bar !== lastBar) { lastBar = bar; cut(s, lyric); }
      else if (beat !== lastBeat && s.beat > 0.95 && s.onset > 0.5 && Math.random() < 0.35) cut(s, lyric);
      lastBeat = beat;
      invert = s.onset > 0.85 && s.beat > 0.9 ? !invert : invert;
      const fg = invert ? "#000" : "#fff";
      const bg = invert ? "#fff" : "#000";
      offset += dt * (60 + 320 * s.energy) * (1 + 1.5 * s.beat);
      const word = ((env.title || "OMS").toUpperCase().replace(/\s+/g, "") + " ").repeat(8);

      if (shot === "dark") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (env.cover) {
          const sz = Math.min(w, h) * 0.38;
          ctx.globalAlpha = 0.45 + 0.3 * s.energy;
          ctx.drawImage(env.cover, (w - sz) / 2, (h - sz) / 2, sz, sz);
          ctx.globalAlpha = 1;
        }
      } else if (shot === "wall") {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const size = Math.round(h / 7.5);
        ctx.font = `${size}px OMSWide, system-ui, sans-serif`;
        ctx.fillStyle = fg;
        ctx.textBaseline = "top";
        const smear = 1 + 0.5 * s.beat;
        for (let row = 0; row < 9; row++) {
          const dir = row % 2 ? 1 : -1;
          const tw = ctx.measureText(word).width / 2 || 1;
          const x = ((dir * offset * (0.7 + (row % 3) * 0.2)) % tw) - tw;
          ctx.save();
          ctx.translate(0, row * size * 0.92 - size * 0.2);
          ctx.scale(smear, 1);
          ctx.fillText(word + word, x / smear, 0);
          ctx.restore();
        }
        if (env.cover) {
          const sz = Math.min(w, h) * sticker.s * (1 + 0.08 * s.beat);
          ctx.save();
          ctx.translate(sticker.x * w + sz / 2, sticker.y * h + sz / 2);
          ctx.rotate(sticker.r);
          ctx.fillStyle = "rgba(0,0,0,.6)";
          ctx.fillRect(-sz / 2 + 14, -sz / 2 + 14, sz, sz);
          ctx.fillStyle = "#fff";
          ctx.fillRect(-sz / 2 - 8, -sz / 2 - 8, sz + 16, sz + 16);
          ctx.drawImage(env.cover, -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        }
      } else {
        // fundo quente com grão, da cor da capa puxada para o fogo
        const g = ctx.createRadialGradient(w * 0.3, h * 0.3, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
        g.addColorStop(0, "#ffb347");
        g.addColorStop(0.35, env.colors[1]);
        g.addColorStop(0.75, "#5a1a05");
        g.addColorStop(1, "#140500");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "overlay";
        const pat = ctx.createPattern(grain, "repeat");
        if (pat) {
          ctx.save();
          ctx.translate((t * 977) % 128, (t * 613) % 128);
          ctx.fillStyle = pat;
          ctx.fillRect(-128, -128, w + 256, h + 256);
          ctx.restore();
        }
        ctx.globalCompositeOperation = "source-over";
        const text = (lyric || env.title || "").toUpperCase();
        const words = text.split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let cur = "";
        const size = Math.round(Math.min(w / 9, h / 5) * (1 + 0.06 * s.beat));
        ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
        for (const wd of words) {
          const next = cur ? `${cur} ${wd}` : wd;
          if (ctx.measureText(next).width > w * 0.78 && cur) { lines.push(cur); cur = wd; } else cur = next;
        }
        if (cur) lines.push(cur);
        ctx.textAlign = "right";
        ctx.lineJoin = "round";
        lines.slice(-4).forEach((ln, i, arr) => {
          const y = h * 0.62 - (arr.length - 1 - i) * size * 0.95;
          ctx.lineWidth = size * 0.12;
          ctx.strokeStyle = "#1a0a05";
          ctx.strokeText(ln, w * 0.92, y);
          ctx.fillStyle = "#fff4ea";
          ctx.fillText(ln, w * 0.92, y);
        });
        ctx.textAlign = "left";
      }
    },
  };
});
