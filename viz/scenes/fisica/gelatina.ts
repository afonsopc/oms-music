/**
 * Gelatina: três gelatinas em forma de pudim num prato, corpos moles (cada
 * uma 40 pontos presos à sua forma por molas, passo fixo a 120 Hz). Cada
 * batida dá uma pancada no prato e elas saltam e tremem, os graves dão a
 * força, a queda atira-as ao ar a rodar. A capa vê-se através da gelatina.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { CssPal, steps } from "./_lib";

const J = 3, P = 40;

export default canvasScene({
  id: "gelatina",
  name: "Gelatina",
  names: { en: "Jelly", lv: "Želeja" },
  families: ["calm", "chaos"],
  tags: ["divertido", "mole", "brinquedo", "capa"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette", "cover"],
  lyrics: "extrude",
}, () => {
  const x = new Float32Array(J * P), y = new Float32Array(J * P), vx = new Float32Array(J * P), vy = new Float32Array(J * P);
  const rx = new Float32Array(P), ry = new Float32Array(P);
  const cx = new Float32Array(J), cy = new Float32Array(J), ang = new Float32Array(J), spin = new Float32Array(J), size = new Float32Array([1, 0.8, 0.65]);
  const pal = new CssPal(6, 0.82), hi = new CssPal(6, 0.35);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  const clock = { acc: 0 };
  let W = 0, H = 0, kick = 0, plate = 0;

  // a forma do pudim: base larga, topo redondo com uma coroa
  for (let i = 0; i < P; i++) {
    const a = (i / P) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const top = s < 0;
    const r = top ? 1 + 0.06 * Math.cos(a * 8) : 1;
    rx[i] = c * (top ? 0.8 + 0.2 * Math.abs(s) * 0 : 1) * r;
    ry[i] = top ? s * 1.05 * r : Math.min(s, 0.35) * 1.2;
  }
  // a forma centrada no centro de massa (senão as molas empurravam a gelatina sozinhas)
  {
    let mx = 0, my = 0;
    for (let i = 0; i < P; i++) { mx += rx[i]; my += ry[i]; }
    for (let i = 0; i < P; i++) { rx[i] -= mx / P; ry[i] -= my / P; }
  }
  const place = (w: number, h: number) => {
    W = w; H = h;
    const k = Math.min(w, h);
    for (let j = 0; j < J; j++) {
      const sc = k * 0.2 * size[j];
      const bx = w * (0.28 + 0.24 * j), by = h * 0.78 - sc * 0.4;
      cx[j] = bx; cy[j] = by; ang[j] = 0; spin[j] = 0;
      for (let i = 0; i < P; i++) { const o = j * P + i; x[o] = bx + rx[i] * sc; y[o] = by + ry[i] * sc; vx[o] = 0; vy[o] = 0; }
    }
  };

  const step = (h: number, floor: number, k: number) => {
    const g = k * 3;
    for (let j = 0; j < J; j++) {
      const sc = k * 0.2 * size[j];
      let mx = 0, my = 0;
      for (let i = 0; i < P; i++) { mx += x[j * P + i]; my += y[j * P + i]; }
      mx /= P; my /= P;
      cx[j] = mx; cy[j] = my;
      // rotação média (para a forma acompanhar a gelatina quando roda)
      let num = 0, den = 0;
      for (let i = 0; i < P; i++) {
        const o = j * P + i, qx = x[o] - mx, qy = y[o] - my;
        num += rx[i] * qy - ry[i] * qx; den += rx[i] * qx + ry[i] * qy;
      }
      ang[j] = Math.atan2(num, den);
      const ca = Math.cos(ang[j]), sa = Math.sin(ang[j]);
      for (let i = 0; i < P; i++) {
        const o = j * P + i;
        const gx = mx + (rx[i] * ca - ry[i] * sa) * sc, gy = my + (rx[i] * sa + ry[i] * ca) * sc;
        vx[o] += (gx - x[o]) * 300 * h; vy[o] += (gy - y[o]) * 300 * h + g * h;
        // tangente: a rotação de quem saltou a rodar
        vx[o] += -(y[o] - my) * spin[j] * h; vy[o] += (x[o] - mx) * spin[j] * h;
        vx[o] *= 0.985; vy[o] *= 0.985;
      }
      spin[j] *= 0.97;
    }
    // umas contra as outras: empurrar para fora do círculo da outra
    for (let j = 0; j < J; j++) for (let m = 0; m < J; m++) {
      if (m === j) continue;
      const rr = k * 0.2 * size[m] * 0.95;
      for (let i = 0; i < P; i++) {
        const o = j * P + i, dx = x[o] - cx[m], dy = y[o] - cy[m], d = Math.hypot(dx, dy);
        if (d < rr && d > 0) { const f = (rr - d) / d; x[o] += dx * f * 0.5; y[o] += dy * f * 0.5; }
      }
    }
    for (let o = 0; o < J * P; o++) {
      x[o] += vx[o] * h; y[o] += vy[o] * h;
      if (y[o] > floor) { y[o] = floor; vy[o] = Math.min(vy[o], -kick); vx[o] *= 0.8; }
      if (y[o] < 0) { y[o] = 0; vy[o] = Math.abs(vy[o]) * 0.5; }
      if (x[o] < 0) { x[o] = 0; vx[o] = Math.abs(vx[o]); }
      if (x[o] > W) { x[o] = W; vx[o] = -Math.abs(vx[o]); }
    }
  };

  return {
    reset() { W = 0; },
    frame(ctx, w, h, dt, _t, s, env) {
      if (w !== W || h !== H) place(w, h);
      pal.update(env); hi.update(env);
      const k = Math.min(w, h), floor = h * 0.8;
      if (beat.hit(s)) { kick = k * (0.15 + 0.55 * s.bass); plate = 1; }
      if (sec.hit(s) && sec.big) { kick = k * 1.1; plate = 1; for (let j = 0; j < J; j++) spin[j] = (Math.random() - 0.5) * 14; }
      const n = steps(clock, env.reduceMotion ? 0 : dt, 120, 8);
      for (let i = 0; i < n; i++) { step(1 / 120, floor, k); kick *= 0.5; }
      plate *= Math.exp(-dt * 8);

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#0a0810";
      ctx.fillRect(0, 0, w, h);
      // o prato
      const py = floor + plate * k * 0.01;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.ellipse(w / 2, py + k * 0.02, w * 0.42, k * 0.05, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(w * 0.1, py, w * 0.8, Math.max(2, k / 200));
      for (let j = 0; j < J; j++) {
        // sombra
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath(); ctx.ellipse(cx[j], floor + k * 0.012, k * 0.2 * size[j], k * 0.02, 0, 0, Math.PI * 2); ctx.fill();
        // o corpo: curva pelos pontos médios
        ctx.beginPath();
        const o = j * P;
        ctx.moveTo((x[o] + x[o + P - 1]) / 2, (y[o] + y[o + P - 1]) / 2);
        for (let i = 0; i < P; i++) {
          const a = o + i, b = o + ((i + 1) % P);
          ctx.quadraticCurveTo(x[a], y[a], (x[a] + x[b]) / 2, (y[a] + y[b]) / 2);
        }
        ctx.closePath();
        ctx.fillStyle = pal.c[j * 2];
        ctx.fill();
        if (env.cover) {
          ctx.save();
          ctx.clip();
          ctx.globalAlpha = 0.3;
          ctx.globalCompositeOperation = "overlay";
          const sc = k * 0.2 * size[j] * 2.2;
          ctx.translate(cx[j], cy[j]); ctx.rotate(ang[j]);
          ctx.drawImage(env.cover, -sc / 2, -sc / 2, sc, sc);
          ctx.restore();
        }
        ctx.strokeStyle = hi.c[j * 2 + 1];
        ctx.lineWidth = Math.max(2, k / 150);
        ctx.stroke();
        // brilho
        const sc = k * 0.2 * size[j];
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.save();
        ctx.translate(cx[j] - sc * 0.35, cy[j] - sc * 0.55);
        ctx.rotate(ang[j] - 0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, sc * 0.2, sc * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    },
  };
});
