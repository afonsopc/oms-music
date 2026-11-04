/**
 * Título em pó: milhares de grãos que formam o título (e depois cada linha
 * da letra) e voam de uma frase para a outra num enxame. Os graves fazem
 * redemoinhar o pó, a batida dá-lhe um sopro para fora, a queda rebenta
 * tudo e as letras voltam a juntar-se; nas calmas o pó assenta.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { noise2 } from "../../lib/noise";
import { Lyric, WIDE, fit, hash1, wrapLines } from "./_lib";

const N = 2600;

export default canvasScene({
  id: "titulo-po",
  name: "Título em pó",
  names: { en: "Dust title", lv: "Putekļu nosaukums" },
  families: ["electronic", "chaos"],
  tags: ["partículas", "texto", "letra", "título", "enxame"],
  intensity: 3,
  cost: 2,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const x = new Float32Array(N), y = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const hx = new Float32Array(N), hy = new Float32Array(N), col = new Uint8Array(N);
  const order = new Uint16Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const sample = document.createElement("canvas");
  const sx = sample.getContext("2d", { willReadFrequently: true })!;
  let ready = false, wFor = 0, hFor = 0, loose = 0, count = N;

  const target = (text: string, w: number, h: number) => {
    const S = 360, sw = S, shh = Math.round((S * h) / w);
    sample.width = sw; sample.height = shh;
    const font = (px: number) => `${px}px ${WIDE}`;
    let size = fit(sx, text, sw * 0.86, font, shh * 0.4);
    let lines = [text];
    if (size < shh * 0.16 && /\s/.test(text)) {
      sx.font = font(shh * 0.17);
      lines = wrapLines(sx, text, sw * 0.86, 3);
      size = shh * 0.3;
      for (const l of lines) size = Math.min(size, fit(sx, l, sw * 0.86, font, shh * 0.3));
    }
    sx.clearRect(0, 0, sw, shh);
    sx.fillStyle = "#fff";
    sx.font = font(size);
    sx.textAlign = "center";
    sx.textBaseline = "middle";
    for (let i = 0; i < lines.length; i++) sx.fillText(lines[i], sw / 2, shh / 2 + (i - (lines.length - 1) / 2) * size * 1.1);
    const d = sx.getImageData(0, 0, sw, shh).data;
    // os píxeis acesos, apanhados ao acaso até N
    let n = 0;
    const step = Math.max(1, Math.floor(Math.sqrt((sw * shh) / (N * 6))));
    const k = w / sw;
    for (let pass = 0; pass < 2 && n < N; pass++) {
      for (let yy = pass; yy < shh && n < N; yy += step) {
        for (let xx = pass; xx < sw && n < N; xx += step) {
          if (d[(yy * sw + xx) * 4 + 3] > 128) {
            const i = order[n++];
            hx[i] = (xx + hash1(n) - 0.5) * k;
            hy[i] = (yy + hash1(n + 99) - 0.5) * k;
          }
        }
      }
    }
    count = Math.max(1, n);
    // os que sobram fazem companhia aos outros
    for (let j = n; j < N; j++) { const i = order[j], src = order[j % count]; hx[i] = hx[src]; hy[i] = hy[src]; }
    // baralhar a ordem para o próximo texto: o enxame cruza-se
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(hash1(i + lyr.serial * 7) * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
  };

  return {
    reset() { ready = false; },
    frame(ctx, w, h, dt, t, s, env) {
      const changed = lyr.update(env, t, s);
      if (!ready || w !== wFor || h !== hFor) {
        for (let i = 0; i < N; i++) { x[i] = hash1(i) * w; y[i] = hash1(i + 0.5) * h; vx[i] = vy[i] = 0; col[i] = i % 3; }
        target(lyr.text || env.title || "OMS", w, h);
        if (env.reduceMotion) for (let i = 0; i < N; i++) { x[i] = hx[i]; y[i] = hy[i]; }
        ready = true; wFor = w; hFor = h;
      } else if (changed) target(lyr.text, w, h);
      if (sec.hit(s) && sec.big) loose = 1;
      if (s.drop > 0.95) loose = 1;
      const k = Math.min(w, h);
      const cx = w / 2, cy = h / 2;
      if (loose === 1) {
        for (let i = 0; i < N; i++) {
          const a = hash1(i * 3 + t) * 6.283, v = k * (1 + 2 * hash1(i + t));
          vx[i] += Math.cos(a) * v; vy[i] += Math.sin(a) * v;
        }
      }
      loose = Math.max(0, loose - dt * 0.8);
      const spring = (14 + 10 * s.energy) * (1 - loose * 0.95);
      const swirl = k * (0.15 + 1.2 * s.bass) * (1 - 0.6 * (s.section === "outro" || s.section === "intro" ? 1 : 0));
      const kick = s.beat > 0.85 ? k * 0.9 * (0.3 + s.bass) : 0;
      const damp = Math.exp(-dt * 6);
      const tt = t * 0.3;
      if (!env.reduceMotion) for (let i = 0; i < N; i++) {
        const dx = hx[i] - x[i], dy = hy[i] - y[i];
        const nx = x[i] / k * 2.2, ny = y[i] / k * 2.2;
        const a = noise2(nx + tt, ny - tt) * 6.283;
        let ax = dx * spring + Math.cos(a) * swirl;
        let ay = dy * spring + Math.sin(a) * swirl;
        if (kick) { const rx = x[i] - cx, ry = y[i] - cy, rl = Math.sqrt(rx * rx + ry * ry) + 1; ax += (rx / rl) * kick * 6; ay += (ry / rl) * kick * 6; }
        vx[i] = (vx[i] + ax * dt) * damp;
        vy[i] = (vy[i] + ay * dt) * damp;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(4,3,8,0.32)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const r = Math.max(1.2, k / 380) * (1 + 0.5 * s.beat);
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = env.colors[c];
        ctx.globalAlpha = 0.85;
        for (let i = c; i < N; i += 3) ctx.fillRect(x[i] - r, y[i] - r, r * 2, r * 2);
      }
      // um brilho branco nos grãos mais rápidos
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < N; i += 5) {
        const sp = Math.abs(vx[i]) + Math.abs(vy[i]);
        if (sp > k * 0.6) ctx.fillRect(x[i] - r * 0.6, y[i] - r * 0.6, r * 1.2, r * 1.2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
