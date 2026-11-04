/**
 * Raízes: raízes luminosas a abrir caminho pela terra escura, de cima para
 * baixo, a ramificar. Crescem mais depressa com os graves, ramificam na
 * batida e brilham nas cores da capa. Nas quedas rebenta um novo feixe de
 * raízes e a terra acende-se; as antigas vão escurecendo e ficam por trás.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { hexToRgb } from "../../lib/palette";
import { PaletteWatch, vividInto } from "./_lib";

const MAXT = 160;

export default canvasScene({
  id: "raizes",
  name: "Raízes",
  names: { en: "Roots", lv: "Saknes" },
  families: ["calm", "electronic"],
  tags: ["natureza", "terra", "escuro", "orgânico", "crescer"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, () => {
  const x = new Float32Array(MAXT), y = new Float32Array(MAXT), a = new Float32Array(MAXT);
  const ox = new Float32Array(MAXT), oy = new Float32Array(MAXT);
  const wd = new Float32Array(MAXT), gen = new Uint8Array(MAXT), alive = new Uint8Array(MAXT), ph = new Float32Array(MAXT);
  const beat = new BeatEdge();
  const sec = new SectionEdge();
  const pal = new PaletteWatch();
  const halo = ["#fff", "#fff", "#fff"], core = ["#fff", "#fff", "#fff"];
  let soil = "#000", soilFade = "rgba(0,0,0,.02)", flash = "rgba(0,0,0,0)";
  let W = 0, H = 0, fade = 0, fl = 0, needPaint = true, growth = 0;

  const spawn = (px: number, py: number, ang: number, w: number, g: number) => {
    for (let i = 0; i < MAXT; i++) {
      if (alive[i]) continue;
      x[i] = px; y[i] = py; ox[i] = px; oy[i] = py; a[i] = ang; wd[i] = w; gen[i] = g; alive[i] = 1; ph[i] = Math.random() * 100;
      return i;
    }
    return -1;
  };
  const seed = (n: number, k: number) => {
    const cx = W * (0.15 + 0.7 * Math.random());
    for (let i = 0; i < n; i++) spawn(cx + (Math.random() - 0.5) * W * 0.25, -2, Math.PI / 2 + (Math.random() - 0.5) * 1.2, k * (0.7 + 0.6 * Math.random()), 0);
  };
  const colors = (cs: readonly string[]) => {
    const c = cs.map((h) => vividInto([0, 0, 0], hexToRgb(h).map((v) => v / 255)));
    for (let i = 0; i < 3; i++) {
      const k = c[i];
      halo[i] = `rgba(${Math.round(k[0] * 255)},${Math.round(k[1] * 255)},${Math.round(k[2] * 255)},.16)`;
      core[i] = `rgb(${Math.round((k[0] * 0.5 + 0.5) * 255)},${Math.round((k[1] * 0.5 + 0.5) * 255)},${Math.round((k[2] * 0.5 + 0.5) * 255)})`;
    }
    const s = [0.12, 0.07, 0.04];
    vividInto(s, c[2], 0.3);
    soil = `rgb(${Math.round(s[0] * 0.25 * 255)},${Math.round(s[1] * 0.25 * 255)},${Math.round(s[2] * 0.25 * 255)})`;
    soilFade = `rgba(${Math.round(s[0] * 0.25 * 255)},${Math.round(s[1] * 0.25 * 255)},${Math.round(s[2] * 0.25 * 255)},.06)`;
    flash = `rgba(${Math.round(c[1][0] * 255)},${Math.round(c[1][1] * 255)},${Math.round(c[1][2] * 255)},.05)`;
  };
  const step = (ctx: CanvasRenderingContext2D, dt: number, t: number, speed: number, branchP: number) => {
    const k = Math.min(W, H);
    for (let i = 0; i < MAXT; i++) {
      if (!alive[i]) continue;
      ox[i] = x[i]; oy[i] = y[i];
      // vaguear + puxar para baixo (gravitropismo)
      a[i] += (Math.sin(t * 1.3 + ph[i]) * 0.9 + Math.sin(t * 3.1 + ph[i] * 2) * 0.5) * dt * 1.5;
      a[i] += (Math.PI / 2 - a[i]) * dt * 0.9;
      const v = speed * k * (0.6 + 0.6 * wd[i] / (k * 0.012));
      x[i] += Math.cos(a[i]) * v * dt;
      y[i] += Math.sin(a[i]) * v * dt;
      wd[i] *= Math.exp(-dt * 0.11 * (1 + gen[i] * 0.3));
    }
    // desenhar por cor (menos mudanças de estilo): halo largo e núcleo fino
    ctx.lineCap = "round";
    for (let c = 0; c < 3; c++) {
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? core[c] : halo[c];
        for (let i = 0; i < MAXT; i++) {
          if (!alive[i] || gen[i] % 3 !== c) continue;
          ctx.lineWidth = pass ? wd[i] : wd[i] * 3.2;
          ctx.beginPath(); ctx.moveTo(ox[i], oy[i]); ctx.lineTo(x[i], y[i]); ctx.stroke();
        }
      }
    }
    for (let i = 0; i < MAXT; i++) {
      if (!alive[i]) continue;
      if (Math.random() < branchP * dt * 60 && gen[i] < 7 && wd[i] > 0.8) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawn(x[i], y[i], a[i] + side * (0.4 + Math.random() * 0.5), wd[i] * 0.7, gen[i] + 1);
        a[i] -= side * 0.15;
      }
      if (wd[i] < 0.45 || y[i] > H + 10 || x[i] < -10 || x[i] > W + 10) alive[i] = 0;
    }
  };
  const prepaint = (ctx: CanvasRenderingContext2D) => {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = soil;
    ctx.fillRect(0, 0, W, H);
    // grão da terra
    ctx.fillStyle = "rgba(255,255,255,.025)";
    for (let i = 0; i < 1400; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    alive.fill(0);
    const k = Math.min(W, H);
    seed(4, k * 0.014);
    seed(3, k * 0.011);
    // já crescidas um bocado (e o frame parado de "reduzir movimento" fica bonito)
    for (let i = 0; i < 260; i++) step(ctx, 1 / 30, i / 30, 0.12, i % 12 === 0 ? 0.08 : 0.002);
  };

  return {
    reset() { needPaint = true; },
    frame(ctx, w, h, dt, t, s, env) {
      if (pal.changed(env.colors)) colors(env.colors);
      if (needPaint || W !== w || H !== h) { W = w; H = h; needPaint = false; prepaint(ctx); }
      const k = Math.min(w, h);
      let branch = 0.002 + 0.004 * s.energy;
      if (beat.hit(s)) {
        branch = 0.25 + 0.3 * s.bass;
        growth = 1;
      }
      if (sec.hit(s)) {
        if (sec.big) { seed(8, k * 0.016); fl = 1; fade = 1.2; }
        else { seed(3, k * 0.012); fade = 0.5; }
      }
      let n = 0;
      for (let i = 0; i < MAXT; i++) n += alive[i];
      if (n < 6) seed(3, k * 0.012);
      growth *= Math.exp(-dt * 5);
      if (fade > 0) {
        fade -= dt;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = soilFade;
        ctx.fillRect(0, 0, w, h);
      }
      if (fl > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fl;
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        fl *= Math.exp(-dt * 4);
      }
      ctx.globalCompositeOperation = "lighter";
      step(ctx, dt, t, 0.06 + 0.18 * s.bass + 0.35 * growth + 0.2 * s.drop, branch);
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
