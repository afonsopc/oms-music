/**
 * Cardume: centenas de peixes no azul, com as três regras dos bandos
 * (afastar, alinhar, juntar). O cardume vira todo de uma vez a cada
 * compasso, nada mais depressa com os graves e brilha prateado quando vira
 * de lado para a luz. Nas quedas passa um predador pelo meio e o cardume
 * rebenta em todas as direcções antes de se voltar a juntar.
 */
import { canvasScene } from "../../lib/canvas";
import { BarEdge, BeatEdge, SectionEdge } from "../../lib/beat";
import { hexToRgb } from "../../lib/palette";
import { PaletteWatch, vividInto } from "./_lib";

const N = 300;
const R = 0.06;

export default canvasScene({
  id: "cardume",
  name: "Cardume",
  names: { en: "Shoal", lv: "Zivju bars" },
  families: ["calm", "electronic"],
  tags: ["natureza", "água", "mar", "partículas"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  const px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const sz = new Float32Array(N), wag = new Float32Array(N);
  const GW = 64, GH = 24;
  const head = new Int32Array(GW * GH), next = new Int32Array(N);
  const bar = new BarEdge();
  const beat = new BeatEdge();
  const sec = new SectionEdge();
  const pal = new PaletteWatch();
  const shades: string[] = ["#fff", "#fff", "#fff", "#fff"];
  const bubX = new Float32Array(40), bubY = new Float32Array(40), bubS = new Float32Array(40);
  let bg: HTMLCanvasElement | null = null, bw = 0, bh = 0, rayCol = "#fff", sharkCol = "#000";
  let tx = 0.8, ty = 0.5, side = 1, shark = -1, sharkY = 0.5, sharkDir = 1, scatter = 0, kick = 0;

  for (let i = 0; i < N; i++) {
    px[i] = 0.4 + Math.random() * 0.8; py[i] = 0.3 + Math.random() * 0.4;
    const a = Math.random() * 6.28; vx[i] = Math.cos(a) * 0.1; vy[i] = Math.sin(a) * 0.1;
    sz[i] = 0.6 + Math.random() * 0.8; wag[i] = Math.random() * 6.28;
  }
  for (let i = 0; i < 40; i++) { bubX[i] = Math.random(); bubY[i] = Math.random(); bubS[i] = 0.5 + Math.random(); }

  const paint = (w: number, h: number, colors: readonly string[]) => {
    if (!bg) bg = document.createElement("canvas");
    bg.width = w; bg.height = h; bw = w; bh = h;
    const g = bg.getContext("2d")!;
    const c1 = vividInto([0, 0, 0], hexToRgb(colors[0]).map((v) => v / 255));
    const c2 = vividInto([0, 0, 0], hexToRgb(colors[1]).map((v) => v / 255));
    const c3 = vividInto([0, 0, 0], hexToRgb(colors[2]).map((v) => v / 255));
    // água: a cor da capa puxada para azul-esverdeado no fundo
    const sea = [0.08, 0.4, 0.6];
    vividInto(sea, c3, 0.3);
    const rgb = (c: number[], k: number, a = 1) => `rgba(${Math.round(c[0] * k * 255)},${Math.round(c[1] * k * 255)},${Math.round(c[2] * k * 255)},${a})`;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgb(sea, 0.75));
    grad.addColorStop(0.35, rgb(sea, 0.35));
    grad.addColorStop(1, rgb(sea, 0.04));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.5, -h * 0.2, 0, w * 0.5, -h * 0.2, h * 0.9);
    sun.addColorStop(0, rgb(c2, 1, 0.45));
    sun.addColorStop(1, rgb(c2, 1, 0));
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const f = [0, 0, 0]; f[0] = 0.75 + i * 0.07; f[1] = 0.85 + i * 0.04; f[2] = 0.9;
      vividInto(f, i & 1 ? c1 : c2, 0.2);
      shades[i] = rgb(f, 1);
    }
    rayCol = rgb(c2, 1, 0.05);
    sharkCol = rgb(sea, 0.08);
    void c1;
  };

  return {
    reset() { pal.reset(); },
    frame(ctx, w, h, dt, t, s, env) {
      if (pal.changed(env.colors) || bw !== w || bh !== h || !bg) paint(w, h, env.colors);
      const A = w / h;
      if (bar.hit(s)) { side = -side; kick = 1; }
      if (beat.hit(s)) kick = Math.max(kick, 0.4 * s.bass);
      if (sec.hit(s) && sec.big) { shark = 0; sharkDir = Math.random() < 0.5 ? 1 : -1; sharkY = 0.35 + Math.random() * 0.3; }
      // o alvo: um oito lento, a trocar de lado a cada compasso
      tx += ((0.5 + 0.38 * side) * A + Math.sin(t * 0.4) * 0.2 - tx) * Math.min(1, dt * 1.2);
      ty += (0.5 + 0.22 * Math.sin(t * 0.53) - ty) * Math.min(1, dt * 1.2);
      let sxp = -10, syp = sharkY;
      if (shark >= 0) {
        shark += dt * 0.55;
        sxp = sharkDir > 0 ? -0.3 + shark * (A + 0.6) : A + 0.3 - shark * (A + 0.6);
        syp = sharkY + Math.sin(shark * 5) * 0.04;
        if (shark > 1) shark = -1;
        scatter = 1;
      }
      scatter *= Math.exp(-dt * 0.8);
      kick *= Math.exp(-dt * 3);
      // grelha
      head.fill(-1);
      const cw = A / GW, ch = 1 / GH;
      for (let i = 0; i < N; i++) {
        let gx = Math.floor(px[i] / cw), gy = Math.floor(py[i] / ch);
        gx = gx < 0 ? 0 : gx >= GW ? GW - 1 : gx; gy = gy < 0 ? 0 : gy >= GH ? GH - 1 : gy;
        const c = gy * GW + gx;
        next[i] = head[c]; head[c] = i;
      }
      let mx = 0, my = 0;
      for (let i = 0; i < N; i++) { mx += px[i]; my += py[i]; }
      mx /= N; my /= N;
      const dl = Math.hypot(tx - mx, ty - my) + 1e-4;
      const vmax = 0.22 + 0.25 * s.bass + 0.3 * kick + 0.4 * scatter;
      const rr = Math.ceil(R / cw), ry = Math.ceil(R / ch);
      const dts = Math.min(dt, 0.05);
      for (let i = 0; i < N; i++) {
        let ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy = 0, n = 0;
        const gx0 = Math.floor(px[i] / cw), gy0 = Math.floor(py[i] / ch);
        for (let gy = gy0 - ry; gy <= gy0 + ry; gy++) {
          if (gy < 0 || gy >= GH) continue;
          for (let gx = gx0 - rr; gx <= gx0 + rr; gx++) {
            if (gx < 0 || gx >= GW) continue;
            for (let j = head[gy * GW + gx]; j >= 0; j = next[j]) {
              if (j === i) continue;
              const dx = px[j] - px[i], dy = py[j] - py[i];
              const d2 = dx * dx + dy * dy;
              if (d2 > R * R) continue;
              ax += vx[j]; ay += vy[j]; cx += dx; cy += dy; n++;
              if (d2 < 0.0012) { sx -= dx / (d2 + 1e-5); sy -= dy / (d2 + 1e-5); }
            }
          }
        }
        let fx = 0, fy = 0;
        if (n > 0) {
          fx += (ax / n - vx[i]) * 3.2 + (cx / n) * 1.2 * (1 - scatter) ;
          fy += (ay / n - vy[i]) * 3.2 + (cy / n) * 2.2 * (1 - scatter);
          fx += sx * 0.006; fy += sy * 0.006;
        }
        const cruise = vmax * 0.85 * Math.min(1, dl * 4) * (1 - scatter);
        fx += ((tx - mx) / dl * cruise - vx[i]) * 1.1 + (mx - px[i]) * 0.25;
        fy += ((ty - my) / dl * cruise - vy[i]) * 1.1 + (my - py[i]) * 0.35;
        if (shark >= 0) {
          const dx = px[i] - sxp, dy = py[i] - syp, d2 = dx * dx + dy * dy;
          if (d2 < 0.12) { const k = 0.9 / (d2 + 0.01); fx += dx * k; fy += dy * k; }
        }
        if (py[i] < 0.08) fy += 1.5; else if (py[i] > 0.92) fy -= 1.5;
        vx[i] += fx * dts; vy[i] += fy * dts;
        const v = Math.hypot(vx[i], vy[i]);
        const lim = shark >= 0 ? vmax * 2.2 : vmax;
        if (v > lim) { vx[i] *= lim / v; vy[i] *= lim / v; }
        else if (v < 0.06) { vx[i] *= 0.06 / (v + 1e-5); vy[i] *= 0.06 / (v + 1e-5); }
        px[i] += vx[i] * dts; py[i] += vy[i] * dts;
        if (px[i] < -0.2) px[i] = A + 0.15; else if (px[i] > A + 0.2) px[i] = -0.15;
        wag[i] += dt * (8 + 30 * v);
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(bg!, 0, 0);
      // raios de luz
      ctx.fillStyle = rayCol;
      for (let r = 0; r < 6; r++) {
        const x0 = w * (0.1 + r * 0.16 + 0.05 * Math.sin(t * 0.2 + r * 2));
        const wd = w * (0.03 + 0.02 * Math.sin(t * 0.3 + r));
        ctx.beginPath();
        ctx.moveTo(x0, 0); ctx.lineTo(x0 + wd, 0);
        ctx.lineTo(x0 + wd * 3 + w * 0.15, h); ctx.lineTo(x0 + w * 0.12, h);
        ctx.fill();
      }
      // peixes: um só caminho por tom (o tom diz se está de lado para a luz)
      const L = h * 0.03;
      for (let shade = 0; shade < 4; shade++) {
        ctx.fillStyle = shades[shade];
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = Math.hypot(vx[i], vy[i]) + 1e-5;
          const ux = vx[i] / v, uy = vy[i] / v;
          const tone = Math.min(3, Math.floor(Math.abs(uy) * 3.2 + (s.beat > 0.5 && (i & 7) === 0 ? 1 : 0)));
          if (tone !== shade) continue;
          const X = px[i] * h, Y = py[i] * h, l = L * sz[i];
          const wg = Math.sin(wag[i]) * 0.35;
          const nx = -uy, ny = ux;
          const tx2 = X - ux * l * 1.1, ty2 = Y - uy * l * 1.1;
          ctx.moveTo(X + ux * l, Y + uy * l);
          ctx.lineTo(X + nx * l * 0.28, Y + ny * l * 0.28);
          ctx.lineTo(tx2 + nx * l * (0.05 + wg * 0.3), ty2 + ny * l * (0.05 + wg * 0.3));
          ctx.lineTo(tx2 - ux * l * 0.5 + nx * l * (0.35 + wg), ty2 - uy * l * 0.5 + ny * l * (0.35 + wg));
          ctx.lineTo(tx2 - ux * l * 0.5 - nx * l * (0.35 - wg), ty2 - uy * l * 0.5 - ny * l * (0.35 - wg));
          ctx.lineTo(tx2 - nx * l * (0.05 - wg * 0.3), ty2 - ny * l * (0.05 - wg * 0.3));
          ctx.lineTo(X - nx * l * 0.28, Y - ny * l * 0.28);
          ctx.closePath();
        }
        ctx.globalAlpha = 0.55 + shade * 0.15;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // o predador: uma sombra grande
      if (shark >= 0) {
        const X = sxp * h, Y = syp * h, l = h * 0.22, d = sharkDir;
        const wg = Math.sin(t * 9) * 0.08;
        ctx.fillStyle = sharkCol;
        ctx.beginPath();
        ctx.moveTo(X + d * l, Y);
        ctx.quadraticCurveTo(X + d * l * 0.3, Y - l * 0.26, X - d * l * 0.6, Y - l * 0.05);
        ctx.lineTo(X - d * l * 1.05, Y - l * (0.32 + wg));
        ctx.lineTo(X - d * l * 0.9, Y);
        ctx.lineTo(X - d * l * 1.05, Y + l * (0.25 - wg));
        ctx.lineTo(X - d * l * 0.6, Y + l * 0.05);
        ctx.quadraticCurveTo(X + d * l * 0.3, Y + l * 0.2, X + d * l, Y);
        ctx.moveTo(X, Y - l * 0.15); ctx.lineTo(X - d * l * 0.2, Y - l * 0.42); ctx.lineTo(X - d * l * 0.35, Y - l * 0.12);
        ctx.fill();
      }
      // bolhas
      ctx.fillStyle = "rgba(255,255,255,.35)";
      for (let i = 0; i < 40; i++) {
        bubY[i] -= dt * 0.05 * bubS[i] * (1 + s.energy);
        if (bubY[i] < -0.02) { bubY[i] = 1.02; bubX[i] = Math.random(); }
        const r = h * 0.003 * bubS[i];
        ctx.fillRect(bubX[i] * w + Math.sin(t * 2 + i) * 4, bubY[i] * h, r, r);
      }
    },
  };
});
