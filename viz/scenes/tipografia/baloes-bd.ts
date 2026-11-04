/**
 * Banda desenhada: uma página de quadradinhos em que cada linha da letra é
 * um balão de fala num quadradinho novo, com a capa em retícula por trás e
 * as palavras a aparecer à medida que são cantadas. Cada secção abre com
 * uma legenda amarela ("Entretanto…", "De repente…") e muda a disposição da
 * página; a batida acende as linhas de velocidade; na queda rebenta uma
 * onomatopeia gigante ("CATRAPUM!"). Sem letra: o título e o artista falam.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { clamp, easeOutBack } from "../../lib/ease";
import { Lyric, RTL_RE, SANS, WIDE, hash1, titleOf, upper, wrapLines } from "./_lib";

const BOOM = ["CATRAPUM!", "PUM!", "ZÁS!", "BUM!", "CRÁS!", "TRÁS!", "ZÁS-TRÁS!"];
const CAPS: Record<string, string> = {
  intro: "ERA UMA VEZ…", verse: "ENTRETANTO…", build: "DE REPENTE…", drop: "!!!", chorus: "OUTRA VEZ…",
  high: "NO AUGE…", breakdown: "MAIS TARDE…", outro: "E POR FIM…", none: "ENTRETANTO…",
};
// disposições: [x, y, w, h] em fracções da página
const LAYOUTS: number[][][] = [
  [[0, 0, 0.5, 0.48], [0.5, 0, 0.5, 0.48], [0, 0.48, 1, 0.52]],
  [[0, 0, 0.42, 1], [0.42, 0, 0.58, 0.5], [0.42, 0.5, 0.58, 0.5]],
  [[0, 0, 0.34, 1], [0.34, 0, 0.33, 1], [0.67, 0, 0.33, 1]],
  [[0, 0, 0.62, 0.55], [0.62, 0, 0.38, 0.55], [0, 0.55, 0.38, 0.45], [0.38, 0.55, 0.62, 0.45]],
];

interface Panel { cv: HTMLCanvasElement; text: string; real: boolean; lines: string[]; words: string[]; wordY: number[]; wordX: number[]; size: number; font: string; bw: number; bh: number; born: number; caption: string; cw: number; bx: number; by: number; r: Float32Array; }

export default canvasScene({
  id: "baloes-bd",
  name: "Banda desenhada",
  names: { en: "Comic book", lv: "Komikss" },
  families: ["chaos", "retro"],
  tags: ["texto", "letra", "quadradinhos", "capa", "brincalhão"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "cover", "palette"],
  lyrics: "own",
  artwork: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const panels: Panel[] = [];
  for (let i = 0; i < 4; i++) panels.push({ cv: document.createElement("canvas"), text: "", real: false, lines: [], words: [], wordY: [], wordX: [], size: 20, font: "", bw: 0, bh: 0, born: -9, caption: "", cw: 0, bx: 0.5, by: 0.3, r: new Float32Array(4) });
  let layout = 0, active = 0, boom = 0, boomWord = BOOM[0], pendingCaption = "", wFor = 0, hFor = 0, fBoom = "", fCap = "";
  const page = { x: 0, y: 0, w: 0, h: 0, gut: 0 };

  const rect = (i: number) => {
    const L = LAYOUTS[layout][i % LAYOUTS[layout].length];
    const g = page.gut, r = panels[i].r;
    r[0] = page.x + L[0] * page.w + g / 2; r[1] = page.y + L[1] * page.h + g / 2; r[2] = L[2] * page.w - g; r[3] = L[3] * page.h - g;
    return r;
  };

  const paintPanel = (i: number, env: { cover: HTMLImageElement | null; colors: [string, string, string] }, seed: number) => {
    const p = panels[i];
    const [, , pw, ph] = rect(i);
    const w = Math.max(2, Math.round(pw)), h = Math.max(2, Math.round(ph));
    p.cv.width = w; p.cv.height = h;
    const x = p.cv.getContext("2d")!;
    const col = env.colors[seed % 3];
    x.fillStyle = col;
    x.fillRect(0, 0, w, h);
    if (env.cover && env.cover.complete && env.cover.naturalWidth) {
      // a capa recortada, grande e de lado, a fazer de cenário
      const z = 1.4 + hash1(seed) * 1.4, s = Math.max(w, h) * z;
      x.globalAlpha = 0.85;
      x.drawImage(env.cover, -hash1(seed + 1) * (s - w), -hash1(seed + 2) * (s - h), s, s);
      x.globalAlpha = 1;
    }
    // retícula por cima
    const cell = Math.max(5, Math.min(w, h) / 34);
    x.fillStyle = "rgba(0,0,0,.35)";
    for (let yy = 0; yy < h + cell; yy += cell) for (let xx = (yy / cell) % 2 ? cell / 2 : 0; xx < w + cell; xx += cell) {
      const r = cell * 0.18 * (0.6 + (yy / h) * 0.9);
      x.beginPath(); x.arc(xx, yy, r, 0, 6.283); x.fill();
    }
    // linhas de velocidade a sair de um ponto
    const cx = w * hash1(seed + 4), cy = h * hash1(seed + 5);
    x.strokeStyle = "rgba(255,255,255,.55)";
    x.lineWidth = Math.max(1, Math.min(w, h) / 160);
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * 6.283 + hash1(k + seed) * 0.1, r0 = Math.min(w, h) * (0.25 + hash1(k * 3) * 0.2);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * w * 2, cy + Math.sin(a) * w * 2); x.stroke();
    }
  };

  const setText = (i: number, ctx: CanvasRenderingContext2D, text: string, t: number) => {
    const p = panels[i];
    const [, , pw, ph] = rect(i);
    let size = Math.min(pw, ph) * 0.1;
    const maxW = pw * 0.7;
    let lines: string[] = [];
    for (let it = 0; it < 6; it++) {
      ctx.font = `800 ${Math.round(size)}px ${SANS}`;
      lines = wrapLines(ctx, upper(text), maxW, 6);
      if (lines.length * size * 1.15 < ph * 0.42) break;
      size *= 0.85;
    }
    p.text = text; p.lines = lines; p.size = size; p.born = t;
    p.font = `800 ${Math.round(size)}px ${SANS}`;
    // onde fica cada palavra (para acenderem uma a uma)
    p.words = []; p.wordY = []; p.wordX = [];
    const lh = size * 1.15;
    const rtl = RTL_RE.test(text);
    let bw = 0;
    for (let li = 0; li < lines.length; li++) {
      const ws = lines[li].split(" ");
      const lw = ctx.measureText(lines[li]).width;
      bw = Math.max(bw, lw);
      let xx = -lw / 2;
      for (const wd of ws) { const ww = ctx.measureText(wd).width; p.words.push(wd); p.wordY.push((li - (lines.length - 1) / 2) * lh); p.wordX.push(rtl ? -(xx + ww) : xx); xx += ctx.measureText(wd + " ").width; }
    }
    p.bw = bw * 0.62 + size * 1.4;
    p.bh = lines.length * lh * 0.62 + size * 1.1;
    p.bx = 0.5 + (hash1(t) - 0.5) * 0.2;
    p.by = 0.12 + hash1(t + 1) * 0.1;
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h);
      const relayout = w !== wFor || h !== hFor;
      if (sec.hit(s) || relayout) {
        if (!relayout) layout = (layout + 1) % LAYOUTS.length;
        pendingCaption = CAPS[s.section] ?? "ENTRETANTO…";
        if (sec.big && !relayout) { boom = 1; boomWord = BOOM[Math.floor(hash1(s.sectionIndex + 3) * BOOM.length)]; }
        wFor = w; hFor = h;
        page.gut = k * 0.022;
        page.w = Math.min(w * 0.96, h * 0.96 * 1.8); page.h = h * 0.94;
        page.x = (w - page.w) / 2; page.y = (h - page.h) / 2;
        fBoom = `900 ${Math.round(k * 0.2)}px ${WIDE}`;
        fCap = `italic 800 ${Math.round(k * 0.03)}px ${SANS}`;
        for (const p of panels) p.cw = 0;
        const n = LAYOUTS[layout].length;
        active = active % n;
        for (let i = 0; i < n; i++) { paintPanel(i, env, i + s.sectionIndex * 3 + 1); if (panels[i].text) setText(i, ctx, panels[i].text, panels[i].born); }
      }
      if (lyr.update(env, t, s)) {
        const n = LAYOUTS[layout].length;
        active = (active + 1) % n;
        setText(active, ctx, lyr.real ? lyr.text : lyr.which === 0 ? titleOf(env) : `— ${lyr.text}`, t);
        panels[active].real = lyr.real;
        panels[active].caption = pendingCaption;
        panels[active].cw = 0;
        pendingCaption = "";
        paintPanel(active, env, lyr.serial * 7 + 3);
      }
      if (s.drop > 0.95) boom = Math.max(boom, 0.99);
      boom = Math.max(0, boom - dt * 0.6);

      const shake = (s.beat * 0.004 + boom * 0.02) * k;
      const sx = (hash1(t * 40) - 0.5) * shake, sy = (hash1(t * 40 + 1) - 0.5) * shake;
      ctx.setTransform(1, 0, 0, 1, sx, sy);
      ctx.fillStyle = "#f4efe2";
      ctx.fillRect(-20, -20, w + 40, h + 40);
      const n = LAYOUTS[layout].length;
      for (let i = 0; i < n; i++) {
        const r = rect(i), x = r[0], y = r[1], pw = r[2], ph = r[3];
        const p = panels[i];
        const isA = i === active;
        ctx.drawImage(p.cv, x, y, pw, ph);
        if (isA && s.beat > 0.05) { ctx.fillStyle = "rgba(255,255,255,1)"; ctx.globalAlpha = s.beat * 0.25; ctx.fillRect(x, y, pw, ph); ctx.globalAlpha = 1; }
        ctx.strokeStyle = "#111";
        ctx.lineWidth = k * (isA ? 0.008 + 0.004 * s.beat : 0.006);
        ctx.strokeRect(x, y, pw, ph);
        // legenda amarela
        if (p.caption) {
          ctx.font = fCap;
          if (!p.cw) p.cw = ctx.measureText(p.caption).width + k * 0.03;
          const cw = p.cw;
          ctx.fillStyle = "#ffe14a";
          ctx.fillRect(x + k * 0.01, y + k * 0.01, cw, k * 0.05);
          ctx.strokeStyle = "#111"; ctx.lineWidth = k * 0.003;
          ctx.strokeRect(x + k * 0.01, y + k * 0.01, cw, k * 0.05);
          ctx.fillStyle = "#111"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(p.caption, x + k * 0.025, y + k * 0.036);
        }
        if (!p.text) continue;
        // o balão
        const age = t - p.born;
        const e = env.reduceMotion ? 1 : easeOutBack(clamp(age / 0.35));
        const bw = p.bw, bh = p.bh;
        ctx.font = p.font;
        const bx = x + pw * p.bx, by = y + ph * p.by + bh * 0.9 + (p.caption ? k * 0.05 : 0);
        ctx.save();
        ctx.translate(bx, by);
        ctx.scale(e, e);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#111";
        ctx.lineWidth = k * 0.005;
        ctx.beginPath();
        ctx.moveTo(-bw * 0.15, bh * 0.85);
        ctx.lineTo(-bw * 0.35, bh * 1.6);
        ctx.lineTo(bw * 0.12, bh * 0.9);
        ctx.ellipse(0, 0, bw, bh, 0, 0.55, 0.55 + 6.0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#111";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const shown = isA && p.text === lyr.text ? lyr.shown(t, env) : 999;
        for (let wi = 0; wi < p.words.length && wi < shown; wi++) ctx.fillText(p.words[wi], p.wordX[wi], p.wordY[wi]);
        ctx.restore();
      }
      // a onomatopeia da queda
      if (boom > 0.01) {
        const e = clamp((1 - boom) * 5);
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-0.15 + Math.sin(t * 20) * 0.02 * boom);
        const sc = (0.4 + 0.7 * easeOutBack(e)) * (1 + 0.05 * s.beat);
        ctx.scale(sc, sc);
        ctx.fillStyle = env.colors[1];
        ctx.strokeStyle = "#111";
        ctx.lineWidth = k * 0.012;
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * 6.283, r = k * (i % 2 ? 0.28 : 0.46) * (0.9 + 0.2 * hash1(i));
          if (i) ctx.lineTo(Math.cos(a) * r * 1.6, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r * 1.6, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.font = fBoom;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = k * 0.03; ctx.lineJoin = "round";
        ctx.strokeText(boomWord, 0, 0, k * 1.1);
        ctx.fillStyle = "#ffe14a";
        ctx.fillText(boomWord, 0, 0, k * 1.1);
        ctx.restore();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
});
