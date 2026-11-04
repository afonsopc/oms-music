/**
 * Onda de pêndulos: 30 pêndulos numa trave, com comprimentos escolhidos para
 * o mais comprido dar uma oscilação por compasso e cada um a seguir mais
 * uma por ciclo de 16 compassos. O relógio é a batida da música, por isso
 * as cobras, as tranças e o caos aparente acertam com o tempo e tudo volta a
 * alinhar-se a cada 16 compassos. Os graves abrem a amplitude, a batida
 * acende as bolas, a queda dá-lhes um empurrão e um rasto longo.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { ballSprites, CssPal } from "./_lib";

const N = 30, CYCLE = 64, BASE = 16; // em batidas: o ciclo inteiro e as oscilações do mais comprido nele

export default canvasScene({
  id: "pendulos",
  name: "Onda de pêndulos",
  names: { en: "Pendulum wave", lv: "Svārstu vilnis" },
  families: ["calm", "retro"],
  tags: ["hipnótico", "ritmo", "3d", "brinquedo"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  const pal = new CssPal(N);
  const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), ord = new Int32Array(N);
  const sprites: HTMLCanvasElement[] = [];
  const sec = new SectionEdge(), push = new Envelope(0.05, 2.5);
  let spriteGen = -1, frameN = 0, amp = 0.5, clockB = 0;

  return {
    reset() {},
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env, true, 10);
      // os brilhos refazem-se de 2 em 2 s (as cores deslizam entre músicas)
      if (frameN++ % 30 === 0 || spriteGen < 0) { ballSprites(pal, sprites); spriteGen = frameN; }
      if (sec.hit(s) && sec.big) push.kick(1);
      push.step(0, dt);
      amp += (0.32 + 0.3 * s.bass + 0.25 * push.v - amp) * Math.min(1, dt * 3);
      // o relógio segue as batidas (suave, sem saltar para trás)
      const target = s.beatPos;
      clockB = Math.abs(target - clockB) > 2 ? target : clockB + (target - clockB) * Math.min(1, dt * 10);
      const tb = env.reduceMotion ? 21.3 : clockB;

      const k = Math.min(w, h), el = 0.78, ce = Math.cos(el), se = Math.sin(el);
      const beamY = h * 0.16, L = h * 0.62, span = w * 0.8, gap = span / (N - 1);
      for (let i = 0; i < N; i++) {
        const osc = BASE + i, th = amp * Math.cos((2 * Math.PI * osc * tb) / CYCLE);
        const lx = -span / 2 + (span * i) / (N - 1);
        // o pêndulo balança no plano y-z (para a frente e para trás); vista de cima, um pouco inclinada
        const y3 = L * Math.cos(th), z3 = L * Math.sin(th);
        const persp = 1 / (1 - (z3 * ce) / (k * 4));
        sx[i] = w / 2 + lx * persp;
        sy[i] = beamY + (y3 * ce + z3 * se) * persp;
        sz[i] = z3;
        ord[i] = i;
      }
      // de trás para a frente
      for (let i = 1; i < N; i++) { const v = ord[i]; let j = i - 1; while (j >= 0 && sz[ord[j]] > sz[v]) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = v; }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(5,4,10,${env.reduceMotion ? 1 : 0.32 - 0.22 * push.v})`;
      ctx.fillRect(0, 0, w, h);
      // a trave
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(w / 2 - span / 2 - k * 0.03, beamY - k * 0.008, span + k * 0.06, k * 0.016);
      // fios
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(1, k / 900);
      ctx.beginPath();
      for (let i = 0; i < N; i++) { const lx = w / 2 - span / 2 + (span * i) / (N - 1); ctx.moveTo(lx, beamY); ctx.lineTo(sx[i], sy[i]); }
      ctx.stroke();
      // as bolas, com o brilho da batida
      ctx.globalCompositeOperation = "lighter";
            for (let q = 0; q < N; q++) {
        const i = ord[q];
        const persp = 1 / (1 - (sz[i] * ce) / (k * 4));
        const r = gap * (0.85 + 0.15 * s.beat) * persp;
        ctx.globalAlpha = 0.85 + 0.15 * s.beat;
        ctx.drawImage(sprites[i], sx[i] - r, sy[i] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
