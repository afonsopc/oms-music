/**
 * Bolas a compasso: sete bolas a saltar em cima de sete barras de um
 * equalizador (as barras são as faixas da música). Cada bola tem o seu
 * tempo, de semínima a compasso inteiro, e aterra sempre em cima da batida:
 * achata, salpica faúlhas e acende a barra. Os graves dão a altura, cada
 * secção baralha os tempos, a queda manda-as ao dobro da altura.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { Particles } from "../../lib/particles";
import { ballSprites, CssPal } from "./_lib";

const N = 7;
const PERIODS = [[4, 2, 1, 1, 0.5, 1, 2], [2, 1, 0.5, 2, 1, 0.5, 4], [1, 1, 2, 4, 2, 1, 1], [0.5, 1, 2, 1, 2, 1, 0.5]];

export default canvasScene({
  id: "ressaltos",
  name: "Bolas a compasso",
  names: { en: "Beat bounce", lv: "Ritma bumbas" },
  families: ["retro", "chaos"],
  tags: ["ritmo", "divertido", "equalizador", "brinquedo"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "lowmid", "mid", "high", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  const pal = new CssPal(N), dim = new CssPal(N, 0.22);
  const sprites: HTMLCanvasElement[] = [];
  const sparks = new Particles(800);
  const lastCycle = new Float64Array(N).fill(-1), flash = new Float32Array(N), bar = new Float32Array(N), bands = new Float32Array(N);
  const sec = new SectionEdge(), drop = new Envelope(0.05, 2);
  let set = 0, n = 0;

  return {
    reset() { sparks.clear(); },
    frame(ctx, w, h, dt, _t, s, env) {
      pal.update(env, true, 10); dim.update(env, true, 10);
      if (n++ % 30 === 0) ballSprites(pal, sprites);
      if (sec.hit(s)) { set = (set + 1) % PERIODS.length; if (sec.big) drop.kick(1); }
      drop.step(0, dt);
      const k = Math.min(w, h), lane = w / (N + 1), floor = h * 0.9, br = Math.min(lane * 0.28, k * 0.06);
      bands[0] = s.bass; bands[1] = s.bass * 0.8 + s.lowmid * 0.2; bands[2] = s.lowmid; bands[3] = s.mid; bands[4] = s.mid * 0.6 + s.high * 0.4; bands[5] = s.high; bands[6] = s.energy;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = env.reduceMotion ? "#06050c" : "rgba(6,5,12,0.5)";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < N; i++) {
        bar[i] += (bands[i] - bar[i]) * Math.min(1, dt * 12);
        const x = lane * (i + 1);
        const top = floor - h * (0.08 + 0.3 * bar[i]);
        const per = PERIODS[set][i];
        const ph = env.reduceMotion ? 0.5 : s.beatPos / per;
        const cyc = Math.floor(ph), p = ph - cyc;
        // aterrou agora: salpicar, acender a barra
        if (cyc !== lastCycle[i]) {
          if (lastCycle[i] >= 0 && !env.reduceMotion) {
            flash[i] = 1;
            const m = 10 + Math.round(20 * s.energy);
            for (let q = 0; q < m; q++) sparks.emit(x + (Math.random() - 0.5) * br, top, (Math.random() - 0.5) * k * 0.9, -Math.random() * k * 0.8, 0.5 + Math.random() * 0.5, i);
          }
          lastCycle[i] = cyc;
        }
        flash[i] *= Math.exp(-dt * 6);
        const air = h * (0.12 + 0.12 * per) * (0.6 + 0.6 * s.bass) * (1 + drop.v);
        const yb = top - br - 4 * p * (1 - p) * Math.min(air, top - br - h * 0.04);
        // achatar perto do chão, esticar a voar
        const near = Math.max(0, 1 - Math.min(p, 1 - p) * 10);
        const v = Math.abs(1 - 2 * p);
        const sqx = 1 + 0.35 * near - 0.12 * v * (1 - near), sqy = 1 - 0.3 * near + 0.18 * v * (1 - near);
        // a barra
        ctx.fillStyle = dim.c[i];
        ctx.fillRect(x - lane * 0.32, top, lane * 0.64, floor - top);
        ctx.fillStyle = pal.c[i];
        ctx.globalAlpha = 0.5 + 0.5 * flash[i];
        ctx.fillRect(x - lane * 0.32, top, lane * 0.64, Math.max(3, k / 120));
        ctx.globalAlpha = 1;
        // sombra na barra
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(x - br * (1.2 - 0.6 * (top - yb) / Math.max(1, air)), top - 2, br * 2 * (1.2 - 0.6 * (top - yb) / Math.max(1, air)), 3);
        // a bola
        const r = br * 1.9;
        if (sprites[i]) ctx.drawImage(sprites[i], x - r * sqx, yb + br - r * sqy * 1.9 * 0.5 - br * sqy, r * 2 * sqx, r * 2 * sqy);
      }
      sparks.step(dt, 0, k * 1.6, 0.5);
      ctx.globalCompositeOperation = "lighter";
      for (let c = 0; c < N; c++) {
        ctx.fillStyle = pal.c[c];
        for (let i = 0; i < sparks.capacity; i++) {
          if (sparks.life[i] <= 0 || sparks.data[i] !== c) continue;
          const l = sparks.life[i] / sparks.max[i], z = Math.max(1, k / 300) * (0.5 + l);
          ctx.globalAlpha = l;
          ctx.fillRect(sparks.x[i] - z, sparks.y[i] - z, z * 2, z * 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
