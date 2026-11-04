/**
 * Espirógrafo: três rosáceas de luz (hipotrocóides, a roda dentro da roda),
 * cada uma com a sua razão de dentes, a rodar umas contra as outras. A cada
 * quatro compassos as rodas trocam-se e as curvas transformam-se nas novas;
 * os graves afastam a caneta (as pétalas incham), as batidas fazem correr
 * cometas pelo traço, a queda abre tudo.
 */
import { canvasScene } from "../../lib/canvas";
import { BarEdge, Envelope, SectionEdge } from "../../lib/beat";
import { css } from "../../lib/palette";

// pares (R, r) de dentes e quantas voltas precisam para fechar
const GEARS = [[96, 30], [105, 42], [120, 52], [96, 60], [84, 36], [150, 56], [100, 36], [90, 66], [112, 40], [128, 48], [99, 27], [120, 75]];
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const TURNS = GEARS.map(([R, r]) => r / gcd(R, r));
const PENS = 3, N = 1000;

export default canvasScene({
  id: "espirografo",
  name: "Espirógrafo",
  names: { en: "Spirograph", lv: "Spirogrāfs" },
  families: ["calm", "electronic"],
  tags: ["curvas", "linhas", "matemática", "néon"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "ink",
}, () => {
  const gear = new Int8Array(PENS), prev = new Int8Array(PENS);
  const pd = new Float32Array(PENS), prevPd = new Float32Array(PENS);
  const spin = new Float64Array(PENS);
  const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
  const col = [0, 0, 0];
  const bar = new BarEdge(4);
  const section = new SectionEdge();
  const open = new Envelope(0.02, 1.2);
  let morph = 1, comet = 0, lastT = -1, seeded = false;
  const pick = (seed: number) => {
    for (let i = 0; i < PENS; i++) {
      prev[i] = gear[i]; prevPd[i] = pd[i];
      gear[i] = Math.floor(seed * 97 + i * 5) % GEARS.length;
      pd[i] = 0.5 + 0.45 * ((seed * 13.7 + i * 0.37) % 1);
    }
  };
  // ponto u (0..1 ao longo da curva fechada) da roda g, caneta d
  let px = 0, py = 0;
  const at = (g: number, d0: number, u: number) => {
    const r = GEARS[g][1] / GEARS[g][0], d = d0 * r, a = u * Math.PI * 2 * TURNS[g];
    const s = 1 / (1 - r + d);
    px = ((1 - r) * Math.cos(a) + d * Math.cos(((1 - r) / r) * a)) * s;
    py = ((1 - r) * Math.sin(a) - d * Math.sin(((1 - r) / r) * a)) * s;
  };
  return {
    reset() {},
    frame(ctx, w, h, dt, t, s, env) {
      if (!seeded) { pick(((env.title.length + env.artist.length) * 0.1371) % 1); pick(((env.title.length + env.artist.length) * 0.1371) % 1); seeded = true; }
      const live = !env.reduceMotion && t !== lastT;
      lastT = t;
      if (bar.hit(s) || (section.hit(s) && section.big)) { pick(Math.random()); morph = 0; }
      if (s.drop > 0.5) open.kick(1);
      open.step(0, dt);
      if (live) {
        morph = Math.min(1, morph + dt / 1.6);
        comet = (comet + dt * (0.03 + 0.12 * s.beat + 0.05 * s.energy)) % 1;
        for (let i = 0; i < PENS; i++) spin[i] += dt * (0.08 + 0.25 * s.energy + 0.6 * s.drop) * (i === 1 ? -1 : 1) * (1 + 0.3 * i);
      }
      const m = morph * morph * (3 - 2 * morph);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = live ? "rgba(0,0,0,0.4)" : "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";
      const k = Math.min(w, h) * 0.46 * (1 + 0.05 * s.beat + 0.12 * open.v);
      for (let i = 0; i < PENS; i++) {
        const sc = k * (1 - 0.17 * i);
        const cs = Math.cos(spin[i]), sn = Math.sin(spin[i]);
        const dd = 1 + 0.3 * s.bass + 0.4 * open.v;
        for (let j = 0; j <= N; j++) {
          const u = j / N;
          at(prev[i], Math.min(1.2, prevPd[i] * dd), u);
          const ax = px, ay = py;
          at(gear[i], Math.min(1.2, pd[i] * dd), u);
          const x = ax + (px - ax) * m, y = ay + (py - ay) * m;
          xs[j] = w / 2 + (x * cs - y * sn) * sc;
          ys[j] = h / 2 + (x * sn + y * cs) * sc;
        }
        const c = env.colorVecs[i];
        const mx = Math.max(c[0], c[1], c[2], 0.05);
        col[0] = c[0] / mx; col[1] = c[1] / mx; col[2] = c[2] / mx;
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = css(col, pass === 0 ? 0.1 + 0.1 * s.energy : 0.55 + 0.3 * s.beat);
          ctx.lineWidth = Math.max(1, k * (pass === 0 ? 0.014 : 0.0028) * (1 + 0.6 * s.bass));
          ctx.beginPath();
          ctx.moveTo(xs[0], ys[0]);
          for (let j = 1; j <= N; j++) ctx.lineTo(xs[j], ys[j]);
          ctx.stroke();
        }
        // cometas a correr pelo traço
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (let c2 = 0; c2 < 4; c2++) {
          const j = Math.floor(((comet * (1 + i * 0.3) + c2 / 4) % 1) * N);
          ctx.beginPath();
          ctx.arc(xs[j], ys[j], Math.max(1.5, k * (0.006 + 0.012 * s.beat)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
