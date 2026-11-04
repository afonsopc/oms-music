/**
 * Dominó: 300 peças numa espiral, em 3D, a cair umas sobre as outras do
 * centro para fora; a onda anda mais depressa com a energia e cada batida
 * dá-lhe um empurrão (e acende a peça que cai). No fim levantam-se todas
 * de uma vez, de trás para a frente, e volta a começar; a queda recomeça
 * logo, a dobrar. As cores da capa correm pela espiral.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { CssPal } from "./_lib";

const N = 300, FMAX = 1.25;
// as faces de uma caixa (índices dos cantos) e a luz de cada uma
const FACES = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
const SHADE = [0.55, 0.85, 0.2, 1.0, 0.7, 0.6];

export default canvasScene({
  id: "domino",
  name: "Dominó",
  names: { en: "Dominoes", lv: "Domino" },
  families: ["calm", "retro"],
  tags: ["brinquedo", "3d", "reacção em cadeia", "divertido"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, () => {
  const pal = new CssPal(24);
  const px = new Float32Array(N), pz = new Float32Array(N), pa = new Float32Array(N), fall = new Float32Array(N), glow = new Float32Array(N);
  const depth = new Float32Array(N), ord = new Int32Array(N);
  const cx = new Float32Array(8), cy = new Float32Array(8), cz = new Float32Array(8), sx = new Float32Array(8), sy = new Float32Array(8);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  let front = -2, mode = 0, standT = 0, speed = 8, ang = 0.4;

  // a espiral, com as peças à mesma distância umas das outras
  {
    let th = 1.2;
    const a = 0.042, step = 0.032;
    for (let i = 0; i < N; i++) {
      const r = a * th;
      px[i] = Math.cos(th) * r; pz[i] = Math.sin(th) * r;
      pa[i] = th + Math.PI / 2 + Math.atan(1 / th);
      th += step / Math.max(0.05, Math.hypot(r, a));
      ord[i] = i;
    }
  }

  return {
    reset() {},
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env, true, 10);
      if (sec.hit(s)) { mode = 1; standT = 0; if (sec.big) speed = 30; }
      if (mode === 0) {
        const sp = (5 + 22 * s.energy) * (env.reduceMotion ? 0 : 1);
        speed += (sp - speed) * Math.min(1, dt * 2);
        front += speed * dt;
        if (beat.hit(s)) { front += 2 + 4 * s.bass; }
        if (front > N + 3) { mode = 1; standT = 0; }
      } else {
        standT += dt * 1.6;
        if (standT >= 1) { mode = 0; front = -2; }
      }
      if (env.reduceMotion) front = N * 0.55;
      for (let i = 0; i < N; i++) {
        let f: number;
        if (mode === 0) { const q = Math.min(1, Math.max(0, front - i)); f = FMAX * q * q; }
        else { const q = Math.min(1, Math.max(0, standT * 1.4 - (1 - i / N) * 0.4)); f = fall[i] * (1 - q * q * (3 - 2 * q)); }
        if (mode === 0 && f > 1.0 && fall[i] <= 1.0) glow[i] = 1;
        fall[i] = f;
        glow[i] *= Math.exp(-dt * 3);
      }

      ang += dt * 0.06;
      const k = Math.min(w, h), scale = k * 0.95, el = 0.85, ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(ang), sa = Math.sin(ang);
      const ox = w / 2, oy = h * 0.54;
      // profundidade de cada peça, para pintar de trás para a frente (quase ordenadas do frame anterior)
      for (let i = 0; i < N; i++) depth[i] = px[i] * sa + pz[i] * ca;
      for (let i = 1; i < N; i++) { const v = ord[i]; let j = i - 1; while (j >= 0 && depth[ord[j]] > depth[v]) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = v; }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#08070d";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.beginPath(); ctx.ellipse(ox, oy, k * 0.75, k * 0.75 * ce, 0, 0, Math.PI * 2); ctx.fill();

      const W2 = 0.011, H = 0.045, D = 0.007;
      for (let q = 0; q < N; q++) {
        const i = ord[q];
        const c = Math.cos(pa[i]), sn = Math.sin(pa[i]), f = fall[i], cf = Math.cos(f), sf = Math.sin(f);
        // cantos: x de lado, y para cima, z na direcção da queda; roda à volta da aresta da frente
        for (let v = 0; v < 8; v++) {
          const lx = v & 1 ? W2 : -W2, ly = v & 2 ? H : 0, lz0 = v & 4 ? D : 0;
          const lz = lz0 - D;
          const ry = ly * cf - lz * sf, rz = ly * sf + lz * cf + D;
          const wx = px[i] + lx * c + rz * -sn, wz = pz[i] + lx * sn + rz * c;
          cx[v] = wx; cy[v] = ry; cz[v] = wz;
          const vx = wx * ca - wz * sa, vz = wx * sa + wz * ca;
          sx[v] = ox + vx * scale;
          sy[v] = oy + (vz * ce - ry * se) * scale;
        }
        const col = Math.floor((i / N) * 24 + ang * 2) % 24;
        let bx = 0, by = 0, bz = 0;
        for (let v = 0; v < 8; v++) { bx += cx[v]; by += cy[v]; bz += cz[v]; }
        bx /= 8; by /= 8; bz /= 8;
        for (let fc = 0; fc < 6; fc++) {
          const F = FACES[fc];
          // visível se a normal (centro da face menos centro da caixa) aponta para a câmara
          const nx = (cx[F[0]] + cx[F[1]] + cx[F[2]] + cx[F[3]]) / 4 - bx, ny = (cy[F[0]] + cy[F[1]] + cy[F[2]] + cy[F[3]]) / 4 - by, nz = (cz[F[0]] + cz[F[1]] + cz[F[2]] + cz[F[3]]) / 4 - bz;
          if ((nx * sa + nz * ca) * se + ny * ce <= 0) continue;
          ctx.fillStyle = pal.c[col];
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(sx[F[0]], sy[F[0]]); ctx.lineTo(sx[F[1]], sy[F[1]]); ctx.lineTo(sx[F[2]], sy[F[2]]); ctx.lineTo(sx[F[3]], sy[F[3]]);
          ctx.closePath();
          ctx.fill();
          const dk = 1 - SHADE[fc] * (1 - glow[i] * 0.8);
          if (dk > 0.02) { ctx.fillStyle = "#000"; ctx.globalAlpha = Math.min(0.85, dk); ctx.fill(); }
          if (glow[i] > 0.05) { ctx.fillStyle = "#fff"; ctx.globalAlpha = glow[i] * 0.5; ctx.fill(); }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
});
