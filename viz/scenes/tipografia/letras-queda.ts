/**
 * Letras em queda: cada palavra cantada cai do céu letra a letra e
 * amontoa-se no chão, aos trambolhões, umas por cima das outras. A batida
 * dá um coice ao chão e faz saltar o monte; os graves sacodem-no; na queda
 * o chão abre-se e cai tudo, e começa um monte novo. Sem letra: o título e
 * o artista a cair.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { JOIN_RE, Lyric, WIDE, hash1, units, upper } from "./_lib";

const MAX = 160;

export default canvasScene({
  id: "letras-queda",
  name: "Letras em queda",
  names: { en: "Falling letters", lv: "Krītošie burti" },
  families: ["chaos", "electronic"],
  tags: ["física", "texto", "letra", "brincalhão"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const floorKick = new Envelope(0.005, 0.15);
  const x = new Float32Array(MAX), y = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX);
  const a = new Float32Array(MAX), va = new Float32Array(MAX), r = new Float32Array(MAX), born = new Float32Array(MAX);
  const colr = new Uint8Array(MAX), alive = new Uint8Array(MAX), word = new Int16Array(MAX);
  const glyph: string[] = new Array(MAX).fill("");
  let next = 0, spawnWord = 0, open = 0, size = 60, wFor = 0, fSmall = "", fBig = "";

  const addWord = (wd: string, w: number, t: number, wi: number) => {
    const us = JOIN_RE.test(wd) ? [wd] : units(upper(wd));
    let tw = 0;
    const ws: number[] = [];
    for (const u of us) { const m = Math.max(size * 0.4, u.length > 1 ? size * 0.62 * u.length : size * 0.8); ws.push(m); tw += m; }
    let px = w / 2 - tw / 2 + (hash1(t) - 0.5) * w * 0.4;
    px = Math.max(size, Math.min(w - tw - size * 0.2, px));
    for (let k = 0; k < us.length; k++) {
      const i = next; next = (next + 1) % MAX;
      glyph[i] = us[k];
      r[i] = Math.max(size * 0.3, ws[k] * 0.48);
      x[i] = px + ws[k] / 2; y[i] = -size * (1 + k * 0.15) - hash1(i + t) * size;
      vx[i] = (hash1(i * 7 + t) - 0.5) * size * 2; vy[i] = size * 2;
      a[i] = (hash1(i * 3 + t) - 0.5) * 0.8; va[i] = (hash1(i * 5 + t) - 0.5) * 4;
      colr[i] = (wi + (hash1(i) > 0.7 ? 1 : 0)) % 4; alive[i] = 1; born[i] = t; word[i] = wi;
      px += ws[k];
    }
  };

  return {
    reset() { alive.fill(0); spawnWord = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h);
      if (w !== wFor) { size = k * 0.13; wFor = w; alive.fill(0); spawnWord = 0; fSmall = `600 ${Math.round(k * 0.035)}px ${WIDE}`; fBig = `${Math.round(size)}px ${WIDE}`; }
      if (lyr.update(env, t, s)) spawnWord = 0;
      const shown = lyr.shown(t, env);
      while (spawnWord < shown) { addWord(lyr.words[spawnWord], w, t, lyr.serial + spawnWord); spawnWord++; }
      if (sec.hit(s) && sec.big) open = 1.2;
      if (s.beat > 0.9) floorKick.kick(0.5 + s.bass);
      floorKick.step(0, dt);
      if (open > 0 && open - dt <= 0) spawnWord = 0;
      open = Math.max(0, open - dt);

      // física: gravidade, chão, paredes e choques entre letras (círculos)
      const g = k * 3.2, floor = h - k * 0.04;
      const sub = env.reduceMotion ? 0 : 2, sdt = dt / 2;
      for (let it = 0; it < sub; it++) {
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          vy[i] += g * sdt;
          vx[i] *= 0.995; va[i] *= 0.99;
          x[i] += vx[i] * sdt; y[i] += vy[i] * sdt; a[i] += va[i] * sdt;
          if (x[i] < r[i]) { x[i] = r[i]; vx[i] = Math.abs(vx[i]) * 0.5; }
          if (x[i] > w - r[i]) { x[i] = w - r[i]; vx[i] = -Math.abs(vx[i]) * 0.5; }
          if (open <= 0 && y[i] > floor - r[i]) {
            y[i] = floor - r[i];
            const kick = floorKick.v * k * 2.2 * (0.6 + 0.8 * hash1(i + Math.floor(t * 4)));
            vy[i] = -Math.abs(vy[i]) * 0.25 - kick;
            vx[i] *= 0.85; va[i] = va[i] * 0.7 + vx[i] / r[i] * 0.3 + (kick ? (hash1(i + t) - 0.5) * 6 : 0);
          }
          if (y[i] > h + k) alive[i] = 0;
        }
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          for (let j = i + 1; j < MAX; j++) {
            if (!alive[j]) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i], rr = r[i] + r[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 1e-6) continue;
            const d = Math.sqrt(d2), push = (rr - d) / d * 0.5;
            x[i] -= dx * push; y[i] -= dy * push; x[j] += dx * push; y[j] += dy * push;
            const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i];
            const vn = (rvx * dx + rvy * dy) / d;
            if (vn < 0) {
              const jn = -vn * 0.6;
              const nx = dx / d, ny = dy / d;
              vx[i] -= nx * jn; vy[i] -= ny * jn; vx[j] += nx * jn; vy[j] += ny * jn;
              const tang = (rvx * -ny + rvy * nx) * 0.02;
              va[i] += tang / r[i] * 10; va[j] -= tang / r[j] * 10;
            }
          }
        }
      }

      // fundo: céu escuro e o chão nas cores da capa
      const [c0, c1, c2] = env.colors;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0b0a10";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.18 + 0.12 * s.bass;
      ctx.fillStyle = c0;
      ctx.fillRect(0, h * 0.62, w, h * 0.38);
      ctx.globalAlpha = 1;
      // a frase que está a cair, pequena, lá em cima
      ctx.font = fSmall;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillText(lyr.text, w / 2, k * 0.05, w * 0.9);
      if (open <= 0) {
        ctx.fillStyle = c1;
        ctx.fillRect(0, floor - floorKick.v * k * 0.02, w, h - floor + 4);
      } else {
        // o chão aberto: duas portas a cair
        const o = Math.min(1, (1.2 - open) * 3);
        ctx.fillStyle = c1;
        ctx.save(); ctx.translate(0, floor); ctx.rotate(o * 1.2); ctx.fillRect(0, 0, w / 2, k * 0.04); ctx.restore();
        ctx.save(); ctx.translate(w, floor); ctx.rotate(-o * 1.2); ctx.fillRect(-w / 2, 0, w / 2, k * 0.04); ctx.restore();
      }
      ctx.font = fBig;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (let i = 0; i < MAX; i++) {
        if (!alive[i]) continue;
        const sc = glyph[i].length > 1 ? 0.7 : 1;
        const fresh = Math.max(0, 1 - (t - born[i]) * 2);
        ctx.setTransform(Math.cos(a[i]) * sc, Math.sin(a[i]) * sc, -Math.sin(a[i]) * sc, Math.cos(a[i]) * sc, x[i], y[i]);
        ctx.fillStyle = "rgba(0,0,0,.45)";
        ctx.fillText(glyph[i], size * 0.05, size * 0.07);
        const ci = colr[i];
        ctx.fillStyle = fresh > 0.5 ? "#fff" : ci === 0 ? c2 : ci === 1 ? "#f4f1ea" : ci === 2 ? c0 : c1;
        ctx.fillText(glyph[i], 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
});
