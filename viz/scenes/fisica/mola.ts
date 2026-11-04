/**
 * Mola nas escadas: uma mola de arco-íris (nas cores da capa) a descer uma
 * escada sem fim, um degrau a cada duas batidas; nos refrões e nas quedas
 * um por batida, nas partes calmas um por compasso. Aterra com um achatamento e um baque
 * no degrau; os graves engordam as espiras.
 */
import { canvasScene } from "../../lib/canvas";
import { isCalm, isPeak } from "../../lib/beat";
import { CssPal } from "./_lib";

const COILS = 46, PTS = COILS * 18;

export default canvasScene({
  id: "mola",
  name: "Mola nas escadas",
  names: { en: "Stair slinky", lv: "Atspere uz kāpnēm" },
  families: ["retro", "calm"],
  tags: ["brinquedo", "divertido", "arco-íris", "3d"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, () => {
  const pal = new CssPal(12);
  const px = new Float32Array(PTS + 1), py = new Float32Array(PTS + 1), pz = new Float32Array(PTS + 1);
  let phase = 0.35, rate = 1, thud = 0, lastStep = 0;

  return {
    reset() {},
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env);
      const target = isPeak(s) || s.drop > 0.3 ? 2 : isCalm(s) ? 0.5 : 1;
      rate += (target - rate) * Math.min(1, dt * 2);
      if (!env.reduceMotion) phase += dt * (s.bpm / 60) * rate * 0.5;
      const step = Math.floor(phase), p = phase - step;
      if (step !== lastStep) { thud = 1; lastStep = step; }
      thud *= Math.exp(-dt * 7);

      const k = Math.min(w, h), sw = k * 0.32, sh = k * 0.19;
      // a câmara segue a mola: os degraus sobem para a esquerda
      const camX = (step + p) * sw, camY = (step + p) * sh;
      const ox = w * 0.38 - camX, oy = h * 0.42 - camY;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#07060b";
      ctx.fillRect(0, 0, w, h);
      // a escada
      const first = step - 4, last = step + 9, dep = k * 0.07;
      for (let i = first; i <= last; i++) {
        const x = ox + i * sw, y = oy + i * sh + sh;
        ctx.fillStyle = pal.c[(((i % 12) + 12) % 12)];
        ctx.globalAlpha = 0.16;
        ctx.fillRect(x, y, sw, h);
        // o tampo do degrau, em perspectiva
        ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dep, y - dep * 0.6); ctx.lineTo(x + sw + dep, y - dep * 0.6); ctx.lineTo(x + sw, y); ctx.fill();
        ctx.globalAlpha = 0.55 + (i === step + 1 ? thud * 0.45 : 0);
        ctx.fillRect(x, y, sw, Math.max(2, k / 160));
        ctx.globalAlpha = 1;
      }

      // a coluna da mola: a ponta de cima da pilha voa para o degrau seguinte e a de baixo vai atrás
      // (no fim a pilha está no degrau novo, com as pontas trocadas, como numa mola a sério)
      const ax = ox + step * sw + sw * 0.5, ay = oy + step * sh + sh;
      const tx = ax + sw, ty = ay + sh;
      const rad = k * (0.06 + 0.015 * s.bass) * (1 + thud * 0.12);
      const hs = rad * 1.3 * (1 - thud * 0.25);
      const ss = (a: number, b: number, x: number) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
      const hp = ss(0, 0.7, p), tp = ss(0.35, 1, p), arc = sh * 1.5 + sw * 0.2;
      const bxp = ax + (tx - ax) * hp, byp = ay - hs + (ty - ay + hs) * hp - Math.sin(Math.PI * hp) * arc;
      const qx = ax + (tx - ax) * tp, qy = ay + (ty - hs - ay) * tp - Math.sin(Math.PI * tp) * arc * 0.5;
      const lift = Math.sin(Math.PI * p) * arc * 0.9;
      const cxp = (qx + bxp) / 2, cyp = (qy + byp) / 2 - lift;
      const flip = (step & 1) === 1;
      for (let i = 0; i <= PTS; i++) {
        let u = i / PTS;
        // espiras apertadas nas pontas, abertas no meio
        u = u - 0.1 * Math.sin(2 * Math.PI * u);
        const iu = 1 - u;
        const sx = iu * iu * qx + 2 * iu * u * cxp + u * u * bxp;
        const sy = iu * iu * qy + 2 * iu * u * cyp + u * u * byp;
        let tx2 = 2 * iu * (cxp - qx) + 2 * u * (bxp - cxp), ty2 = 2 * iu * (cyp - qy) + 2 * u * (byp - cyp);
        if (Math.abs(tx2) + Math.abs(ty2) < 1e-3) { tx2 = 0; ty2 = -1; }
        const tl = Math.hypot(tx2, ty2) || 1;
        const nx = -ty2 / tl, ny = tx2 / tl;
        const th = (i / PTS) * COILS * Math.PI * 2;
        const c = Math.cos(th), sn = Math.sin(th);
        px[i] = sx + nx * rad * c * (1 - thud * 0.15) + (tx2 / tl) * rad * sn * 0.25;
        py[i] = sy + ny * rad * c;
        pz[i] = sn;
      }
      ctx.lineCap = "round";
      const lw = Math.max(1.5, k / 260);
      // atrás primeiro (escuras), à frente depois (com brilho)
      for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? lw : lw * 1.15;
        for (let c = 0; c < 12; c++) {
          ctx.strokeStyle = pal.c[flip ? 11 - c : c];
          ctx.globalAlpha = pass === 0 ? 0.45 : 1;
          ctx.beginPath();
          const i0 = Math.floor((c / 12) * PTS), i1 = Math.floor(((c + 1) / 12) * PTS);
          let pen = false;
          for (let i = i0; i < i1; i++) {
            const front = pz[i] + pz[i + 1] > 0;
            if (front === (pass === 1)) {
              if (!pen) { ctx.moveTo(px[i], py[i]); pen = true; }
              ctx.lineTo(px[i + 1], py[i + 1]);
            } else pen = false;
          }
          ctx.stroke();
        }
      }
      // brilho do metal nas espiras da frente
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = lw * 0.35;
      ctx.beginPath();
      for (let i = 0; i < PTS; i++) {
        const th = (i / PTS) * COILS * Math.PI * 2;
        if (Math.cos(th - 1.2) > 0.92 && pz[i] > 0) { ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i + 1], py[i + 1]); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
});
