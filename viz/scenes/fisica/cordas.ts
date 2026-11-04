/**
 * Cordas: seis cordas esticadas de lado a lado, cada uma uma equação de onda
 * a sério (160 pontos, passo fixo), vistas em câmara lenta e com exposição
 * longa, por isso a vibração deixa o seu envelope luminoso. Os graves
 * dedilham as grossas, os médios as do meio, os agudos e os ataques as
 * finas; a queda é um rasgado em todas.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge, Trigger } from "../../lib/beat";
import { CssPal, steps } from "./_lib";

const S = 6, N = 160;

export default canvasScene({
  id: "cordas",
  name: "Cordas",
  names: { en: "Strings", lv: "Stīgas" },
  families: ["calm", "retro"],
  tags: ["guitarra", "acústico", "linhas", "onda"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "mid", "high", "beat", "onset", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  const y = new Float32Array(S * N), y0 = new Float32Array(S * N), yn = new Float32Array(S * N);
  const energy = new Float32Array(S);
  // velocidade da onda (Courant²) e amortecimento: graves lentos e longos, agudos rápidos
  const r = new Float32Array([0.22, 0.3, 0.42, 0.56, 0.74, 0.95]);
  const damp = new Float32Array([0.9994, 0.9993, 0.9991, 0.9989, 0.9986, 0.9983]);
  const pal = new CssPal(S);
  const glow = new CssPal(S, 0.18);
  const beat = new BeatEdge(1), sec = new SectionEdge(), on = new Trigger(0.55, 0.25), hi = new Trigger(0.6, 0.35);
  const clock = { acc: 0 };
  let mid = 0;

  const pluck = (s: number, amp: number) => {
    const at = 0.12 + Math.random() * 0.3, k = Math.floor(at * N), o = s * N;
    for (let i = 1; i < N - 1; i++) {
      const v = i <= k ? i / k : (N - 1 - i) / (N - 1 - k);
      y[o + i] += amp * v * (Math.random() < 0.5 ? 1 : 1);
      y0[o + i] = y[o + i];
    }
    energy[s] = 1;
  };

  return {
    reset() { y.fill(0); y0.fill(0); clock.acc = 0; },
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env); glow.update(env);
      if (beat.hit(s)) { pluck(s.bass > 0.5 ? 0 : 1, 0.5 + 0.6 * s.bass); if (s.bass > 0.6) pluck(0, 0.4); }
      if (on.hit(s.onset)) pluck(2 + Math.floor(Math.random() * 2), 0.5 + 0.4 * s.mid);
      if (hi.hit(s.high)) pluck(4 + Math.floor(Math.random() * 2), 0.45);
      mid += dt * s.mid;
      if (mid > 1.2) { mid = 0; pluck(2 + Math.floor(Math.random() * 3), 0.3); }
      if (sec.hit(s)) for (let i = 0; i < S; i++) pluck(i, sec.big ? 1 : 0.5);
      if (env.reduceMotion && y[N >> 1] === 0) for (let i = 0; i < S; i++) pluck(i, 0.6);
      // 8 subpassos por frame a 60 Hz: câmara lenta com as frequências certas entre si
      const n = steps(clock, env.reduceMotion ? 0 : dt, 60, 3) * 8;
      for (let k = 0; k < n; k++) {
        for (let s2 = 0; s2 < S; s2++) {
          const o = s2 * N, c = r[s2], d = damp[s2];
          for (let i = 1; i < N - 1; i++) yn[o + i] = (2 * y[o + i] - y0[o + i] + c * (y[o + i - 1] - 2 * y[o + i] + y[o + i + 1])) * d;
          for (let i = 1; i < N - 1; i++) { y0[o + i] = y[o + i]; y[o + i] = yn[o + i]; }
        }
      }
      for (let i = 0; i < S; i++) energy[i] *= Math.exp(-dt * 1.5);

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(4,3,8,${env.reduceMotion ? 1 : 0.22})`;
      ctx.fillRect(0, 0, w, h);
      // trastes
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let f = 1; f < 12; f++) { const x = w * (1 - Math.pow(0.5, f / 6)) * 1.02; ctx.fillRect(x, h * 0.18, Math.max(1, w / 900), h * 0.64); }
      ctx.globalCompositeOperation = "lighter";
      const top = h * 0.24, gap = (h * 0.52) / (S - 1), amp = h * 0.055;
      for (let s2 = 0; s2 < S; s2++) {
        const o = s2 * N, base = top + gap * (S - 1 - s2);
        const lw = Math.max(1, (h / 400) * (2.6 - s2 * 0.35));
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass === 0 ? glow.c[s2] : pal.c[s2];
          ctx.lineWidth = pass === 0 ? lw * (5 + 6 * energy[s2]) : lw;
          ctx.beginPath();
          for (let i = 0; i < N; i++) {
            const x = (i / (N - 1)) * w, yy = base + y[o + i] * amp;
            if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
