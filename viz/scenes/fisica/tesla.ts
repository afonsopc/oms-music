/**
 * Bobina de Tesla: uma torre com um toro no topo a soltar descargas que se
 * ramificam (deslocamento do ponto médio, refeitas 30 vezes por segundo).
 * A energia dá o número de raios, os graves o alcance, cada batida descarrega
 * para o chão, os agudos acendem faíscas no toro, a queda rebenta para todas
 * as bordas com um clarão.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { CssPal, steps } from "./_lib";

const SEG = 64, MAX = 40;

export default canvasScene({
  id: "tesla",
  name: "Bobina de Tesla",
  names: { en: "Tesla coil", lv: "Teslas spole" },
  families: ["chaos", "retro"],
  tags: ["electricidade", "relâmpago", "escuro", "brutal"],
  intensity: 5,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "drop", "section", "palette"],
  lyrics: "glitch",
}, () => {
  const bx = new Float32Array(MAX * (SEG + 1)), by = new Float32Array(MAX * (SEG + 1));
  const bseg = new Int32Array(MAX), bw = new Float32Array(MAX), bc = new Int32Array(MAX);
  const pal = new CssPal(6);
  const beat = new BeatEdge(1), sec = new SectionEdge(), flash = new Envelope(0.005, 0.25), strike = new Envelope(0.005, 0.18);
  const clock = { acc: 0 };
  let nb = 0, ground = 0, groundX = 0, burst = 0;

  const bolt = (x0: number, y0: number, x1: number, y1: number, segs: number, rough: number, width: number, color: number) => {
    if (nb >= MAX) return -1;
    const b = nb++, o = b * (SEG + 1);
    bseg[b] = segs; bw[b] = width; bc[b] = color;
    bx[o] = x0; by[o] = y0; bx[o + segs] = x1; by[o + segs] = y1;
    let len = Math.hypot(x1 - x0, y1 - y0);
    for (let step = segs >> 1; step >= 1; step >>= 1) {
      len *= 0.5;
      for (let i = step; i < segs; i += step * 2) {
        const ax = bx[o + i - step], ay = by[o + i - step], cx = bx[o + i + step], cy = by[o + i + step];
        const dx = cx - ax, dy = cy - ay, l = Math.hypot(dx, dy) || 1;
        const off = (Math.random() - 0.5) * len * rough;
        bx[o + i] = (ax + cx) * 0.5 - (dy / l) * off;
        by[o + i] = (ay + cy) * 0.5 + (dx / l) * off;
      }
    }
    return b;
  };
  const branchy = (x0: number, y0: number, x1: number, y1: number, w: number, color: number) => {
    const b = bolt(x0, y0, x1, y1, SEG, 1.1, w, color);
    if (b < 0) return;
    const o = b * (SEG + 1);
    for (let k = 0; k < 3; k++) {
      const i = 8 + Math.floor(Math.random() * (SEG - 16));
      const px = bx[o + i], py = by[o + i];
      const dx = x1 - x0, dy = y1 - y0, a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6, l = Math.hypot(dx, dy) * (0.2 + 0.3 * Math.random());
      bolt(px, py, px + Math.cos(a) * l, py + Math.sin(a) * l, 16, 1.2, w * 0.5, color);
    }
  };

  return {
    reset() { nb = 0; },
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env);
      const k = Math.min(w, h), cx = w / 2, top = h * 0.62, tr = k * 0.12;
      if (beat.hit(s)) { strike.kick(1); ground = 1; groundX = w * (0.1 + 0.8 * Math.random()); }
      if (sec.hit(s) && sec.big) { burst = 1; flash.kick(1); }
      flash.step(0, dt); strike.step(0, dt);
      burst = Math.max(0, burst - dt * 0.8);
      // os raios refazem-se a 30 Hz (o tremer); com movimento reduzido, uma vez
      const regen = env.reduceMotion ? (nb === 0 ? 1 : 0) : steps(clock, dt, 30, 1);
      if (regen) {
        nb = 0;
        const n = 2 + Math.round(6 * s.energy + 4 * s.bass + 10 * burst);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI * (0.05 + 0.9 * Math.random());
          const reach = k * (0.22 + 0.4 * s.bass + 0.3 * burst) * (0.6 + 0.6 * Math.random());
          const sx = cx + Math.cos(a) * tr, sy = top + Math.sin(a) * tr * 0.35;
          let ex = sx + Math.cos(a) * reach, ey = sy + Math.sin(a) * reach;
          if (burst > 0.3 && i % 2 === 0) { const e = Math.random(); ex = e < 0.5 ? (e < 0.25 ? 0 : w) : w * Math.random(); ey = e < 0.5 ? h * Math.random() * 0.8 : 0; }
          branchy(sx, sy, ex, ey, 1 + s.bass, i % 6);
        }
        if (ground > 0.05) {
          branchy(cx + (groundX > cx ? tr : -tr), top, groundX, h * 0.98, 2.2, 0);
          ground *= 0.55;
        }
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(2,2,6,0.55)";
      ctx.fillRect(0, 0, w, h);
      if (flash.v > 0.02) { ctx.globalAlpha = flash.v * 0.6; ctx.fillStyle = pal.c[1]; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
      // a torre: o enrolamento e o toro
      const tw = k * 0.05;
      ctx.fillStyle = "#0b0b10";
      ctx.fillRect(cx - tw, top, tw * 2, h - top);
      ctx.fillStyle = "rgba(190,120,60,0.35)";
      for (let yy = top + tr * 0.4; yy < h; yy += Math.max(2, k / 200)) ctx.fillRect(cx - tw, yy, tw * 2, 1);
      ctx.fillStyle = "#1a1a22";
      ctx.beginPath(); ctx.ellipse(cx, top, tr, tr * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.ellipse(cx, top - tr * 0.1, tr * 0.8, tr * 0.12, 0, 0, Math.PI * 2); ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const lw = Math.max(1, k / 500);
      for (let pass = 0; pass < 3; pass++) {
        for (let b = 0; b < nb; b++) {
          if (pass === 0 && bw[b] < 1) continue;
          const o = b * (SEG + 1), n = bseg[b];
          ctx.strokeStyle = pass === 2 ? "#fff" : pal.c[bc[b]];
          ctx.globalAlpha = pass === 0 ? 0.12 : pass === 1 ? 0.35 : 0.9;
          ctx.lineWidth = lw * bw[b] * (pass === 0 ? 6 : pass === 1 ? 2.5 : 0.8) * (1 + strike.v * 0.5);
          ctx.beginPath();
          ctx.moveTo(bx[o], by[o]);
          for (let i = 1; i <= n; i++) ctx.lineTo(bx[o + i], by[o + i]);
          ctx.stroke();
        }
      }
      // faíscas no toro
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.c[2];
      const sp = Math.round(20 * s.high);
      for (let i = 0; i < sp; i++) { const a = Math.random() * Math.PI * 2; ctx.fillRect(cx + Math.cos(a) * tr, top + Math.sin(a) * tr * 0.32, lw * 2, lw * 2); }
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
