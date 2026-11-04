/**
 * Lissajous 3D: uma curva de Lissajous no espaço (três senos com razões
 * inteiras), desenhada como um fio de luz com profundidade. As razões mudam
 * em cada secção, a fase escorrega com os médios e a curva respira com os
 * graves; nas batidas corre um cometa pelo fio.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { css } from "../../lib/palette";

const RATIOS = [[3, 2, 5], [5, 4, 3], [3, 4, 7], [1, 2, 3], [5, 6, 7], [2, 3, 7], [4, 5, 9], [3, 5, 8]];
const N = 900;
const BUCKETS = 8;

export default canvasScene({
  id: "lissajous",
  name: "Lissajous 3D",
  names: { en: "3D Lissajous", lv: "3D Lisažū figūra" },
  families: ["calm", "electronic"],
  tags: ["curvas", "3d", "linhas", "osciloscópio"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "mid", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  const sx = new Float32Array(N + 1), sy = new Float32Array(N + 1), sz = new Float32Array(N + 1);
  const section = new SectionEdge();
  const col = [0, 0, 0];
  let ri = 0, phase = 0, spin = 0, comet = 0, from = 0, morph = 1, lastT = -1;
  return {
    reset() {},
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h) * 0.36;
      const live = !env.reduceMotion && t !== lastT;
      lastT = t;
      if (section.hit(s)) { from = ri; ri = (ri + 1 + Math.floor(Math.random() * (RATIOS.length - 1))) % RATIOS.length; morph = 0; }
      if (live) {
        morph = Math.min(1, morph + dt / 1.5);
        phase += dt * (0.15 + 0.8 * s.mid);
        spin += dt * (0.25 + 0.6 * s.energy + 2 * s.drop);
        comet = (comet + dt * (0.15 + 0.5 * s.beat)) % 1;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = live ? "rgba(0,0,0,0.35)" : "#000";
      ctx.fillRect(0, 0, w, h);
      const A = RATIOS[ri], B = RATIOS[from];
      const m = morph * morph * (3 - 2 * morph);
      const breathe = 1 + 0.12 * s.bass + 0.06 * s.beat;
      const cy = Math.cos(spin), syy = Math.sin(spin), cx = Math.cos(0.5 + 0.3 * Math.sin(spin * 0.4)), sxx = Math.sin(0.5 + 0.3 * Math.sin(spin * 0.4));
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * Math.PI * 2;
        const ax = A[0] + (B[0] - A[0]) * (1 - m), ay = A[1] + (B[1] - A[1]) * (1 - m), az = A[2] + (B[2] - A[2]) * (1 - m);
        let x = Math.sin(ax * u + phase), y = Math.sin(ay * u), z = Math.sin(az * u + phase * 0.7);
        // rodar (y e depois x) e projectar
        const x1 = cy * x + syy * z, z1 = -syy * x + cy * z;
        const y1 = cx * y - sxx * z1, z2 = sxx * y + cx * z1;
        x = x1; y = y1; z = z2;
        const p = 3 / (3.4 - z);
        sx[i] = w / 2 + x * k * p * breathe;
        sy[i] = h / 2 + y * k * p * breathe;
        sz[i] = (z + 1) / 2;
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      // por camadas de profundidade: o de trás fino e escuro, o da frente grosso e claro
      for (let b = 0; b < BUCKETS; b++) {
        const lo = b / BUCKETS, hi = (b + 1) / BUCKETS, dz = (b + 0.5) / BUCKETS;
        const c = env.colorVecs[b % 3];
        const mx = Math.max(c[0], c[1], c[2], 0.05);
        col[0] = c[0] / mx; col[1] = c[1] / mx; col[2] = c[2] / mx;
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = css(col, pass === 0 ? 0.12 + 0.1 * dz : 0.35 + 0.6 * dz);
          ctx.lineWidth = Math.max(1, k * (0.004 + 0.01 * dz) * (pass === 0 ? 4 : 1) * (1 + 0.8 * s.beat));
          ctx.beginPath();
          let open = false;
          for (let i = 0; i < N; i++) {
            const z = 0.5 * (sz[i] + sz[i + 1]);
            if (z >= lo && z < hi) {
              if (!open) { ctx.moveTo(sx[i], sy[i]); open = true; }
              ctx.lineTo(sx[i + 1], sy[i + 1]);
            } else open = false;
          }
          ctx.stroke();
        }
      }
      // cometas: correm pelo fio, mais nas batidas
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      for (let c = 0; c < 3; c++) {
        const i = Math.floor(((comet + c / 3) % 1) * N);
        const r = k * (0.012 + 0.02 * s.beat + 0.03 * s.drop) * (0.5 + sz[i]);
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
