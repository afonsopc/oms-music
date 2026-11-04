/**
 * Carta anónima: a letra colada letra a letra com recortes de jornais e
 * revistas, cada um com o seu papel, a sua cor e o seu tipo, tortos e com
 * sombra. As palavras colam-se quando são cantadas, com uma palmada; a
 * batida faz estremecer os recortes, os graves aproximam a folha, e na
 * queda os recortes voam todos e começa outra carta.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { clamp, easeOutBack } from "../../lib/ease";
import { JOIN_RE, Lyric, MONO, SANS, SERIF, WIDE, hash1, units } from "./_lib";

const MAXC = 80;
const BASE = 110;
const PAPERS = ["#f5f1e6", "#e9e2cf", "#ffffff", "#ffe14a", "#111111", "#d9d4c7", "#f7c9d4"];
const FACES = [
  (px: number) => `${px}px ${WIDE}`,
  (px: number) => `900 ${px}px ${SANS}`,
  (px: number) => `italic 700 ${px}px ${SERIF}`,
  (px: number) => `700 ${px}px ${MONO}`,
  (px: number) => `${px}px ${SERIF}`,
  (px: number) => `italic 900 ${px}px ${SANS}`,
];

export default canvasScene({
  id: "carta-anonima",
  name: "Carta anónima",
  names: { en: "Ransom note", lv: "Anonīmā vēstule" },
  families: ["chaos", "retro"],
  tags: ["recortes", "papel", "texto", "letra", "colagem", "punk"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const atlas = document.createElement("canvas"), ax = atlas.getContext("2d")!;
  atlas.width = 2048; atlas.height = 1024;
  // por recorte: lugar no atlas, tamanho, posição na folha, rotação, palavra
  const sx = new Float32Array(MAXC), sy = new Float32Array(MAXC), sw = new Float32Array(MAXC), sh = new Float32Array(MAXC);
  const px = new Float32Array(MAXC), py = new Float32Array(MAXC), rot = new Float32Array(MAXC), wordOf = new Int16Array(MAXC);
  // os que voam (a carta anterior)
  const fx = new Float32Array(MAXC), fy = new Float32Array(MAXC), fvx = new Float32Array(MAXC), fvy = new Float32Array(MAXC), fr = new Float32Array(MAXC), fvr = new Float32Array(MAXC);
  const fsx = new Float32Array(MAXC), fsy = new Float32Array(MAXC), fsw = new Float32Array(MAXC), fsh = new Float32Array(MAXC);
  const old = document.createElement("canvas"), oax = old.getContext("2d")!;
  old.width = 2048; old.height = 1024;
  let n = 0, fn = 0, scale = 1, wFor = 0, hFor = 0, fly = 0;

  const compose = (w: number, h: number) => {
    const text = lyr.text;
    const join = JOIN_RE.test(text);
    ax.clearRect(0, 0, 2048, 1024);
    n = 0;
    let ax0 = 0, ay0 = 0, rowH = 0;
    const ws = lyr.words;
    // os recortes de cada palavra, no atlas
    const wordW: number[] = [];
    const first: number[] = [];
    for (let wi = 0; wi < lyr.n && n < MAXC; wi++) {
      const us = join ? [ws[wi]] : units(ws[wi]);
      first.push(n);
      let ww = 0;
      for (const u of us) {
        if (n >= MAXC) break;
        const seed = lyr.serial * 31 + n * 7;
        const face = FACES[Math.floor(hash1(seed) * FACES.length)];
        const fs = BASE * (0.75 + hash1(seed + 1) * 0.5);
        ax.font = face(fs);
        const tw = ax.measureText(u).width;
        const cw = tw + fs * (0.25 + hash1(seed + 2) * 0.3), ch = fs * (1.15 + hash1(seed + 3) * 0.3);
        if (ax0 + cw > 2048) { ax0 = 0; ay0 += rowH + 4; rowH = 0; }
        if (ay0 + ch > 1024) break;
        sx[n] = ax0; sy[n] = ay0; sw[n] = cw; sh[n] = ch;
        // papel com as beiras rasgadas
        const pi = Math.floor(hash1(seed + 4) * (PAPERS.length + 2));
        const paper = pi < PAPERS.length ? PAPERS[pi] : pi === PAPERS.length ? "#c8102e" : "#2b5fd9";
        ax.fillStyle = paper;
        ax.beginPath();
        const steps = 7;
        for (let k = 0; k <= steps; k++) ax.lineTo(ax0 + (cw * k) / steps, ay0 + hash1(seed + k) * 4);
        for (let k = 0; k <= steps; k++) ax.lineTo(ax0 + cw - hash1(seed + k + 20) * 4, ay0 + (ch * k) / steps);
        for (let k = steps; k >= 0; k--) ax.lineTo(ax0 + (cw * k) / steps, ay0 + ch - hash1(seed + k + 40) * 4);
        for (let k = steps; k >= 0; k--) ax.lineTo(ax0 + hash1(seed + k + 60) * 4, ay0 + (ch * k) / steps);
        ax.fill();
        const dark = paper === "#111111" || paper === "#c8102e" || paper === "#2b5fd9";
        ax.fillStyle = dark ? (hash1(seed + 5) > 0.5 ? "#fff" : "#ffe14a") : hash1(seed + 6) > 0.75 ? "#c8102e" : "#111";
        ax.textAlign = "center";
        ax.textBaseline = "middle";
        ax.fillText(u, ax0 + cw / 2, ay0 + ch * 0.54);
        if (hash1(seed + 8) > 0.8) { ax.fillStyle = "rgba(0,0,0,.15)"; ax.fillRect(ax0, ay0 + ch * 0.8, cw, 2); }
        ax0 += cw + 4; rowH = Math.max(rowH, ch);
        wordOf[n] = wi;
        ww += cw * 0.92;
        n++;
      }
      wordW.push(ww);
    }
    // dispor na folha: linhas que cabem em 86 % da largura
    const maxW = w * 0.86;
    let total = 0;
    for (const ww of wordW) total += ww + BASE * 0.5;
    const rows = Math.max(1, Math.ceil(total / (maxW / 1)) );
    scale = Math.min(1.4, Math.max(0.25, Math.min((maxW * rows) / Math.max(1, total), (h * 0.8) / (rows * BASE * 1.5))));
    // partir em linhas com a escala escolhida
    for (let pass = 0; pass < 4; pass++) {
      let x = 0, lines = 1;
      for (const ww of wordW) { if (x > 0 && x + ww * scale > maxW) { lines++; x = 0; } x += (ww + BASE * 0.45) * scale; }
      if (lines * BASE * 1.5 * scale <= h * 0.8) break;
      scale *= 0.85;
    }
    const rtl = lyr.rtl;
    const lineOf: number[] = [];
    const lineW: number[] = [];
    let x = 0, li = 0;
    for (let wi = 0; wi < wordW.length; wi++) {
      if (x > 0 && x + wordW[wi] * scale > maxW) { lineW.push(x); li++; x = 0; }
      lineOf.push(li);
      x += (wordW[wi] + BASE * 0.45) * scale;
    }
    lineW.push(x);
    const lh = BASE * 1.5 * scale;
    const top = h / 2 - ((li + 1) * lh) / 2 + lh / 2;
    let cx = 0, curLine = -1;
    for (let wi = 0; wi < wordW.length; wi++) {
      if (lineOf[wi] !== curLine) { curLine = lineOf[wi]; cx = rtl ? w / 2 + lineW[curLine] / 2 : w / 2 - lineW[curLine] / 2; }
      const end = wi + 1 < first.length ? first[wi + 1] : n;
      let x0 = rtl ? cx - wordW[wi] * scale : cx;
      for (let c = first[wi]; c < end; c++) {
        const seed = lyr.serial * 13 + c;
        px[c] = x0 + (sw[c] * scale) / 2;
        py[c] = top + curLine * lh + (hash1(seed) - 0.5) * lh * 0.18;
        rot[c] = (hash1(seed + 1) - 0.5) * 0.35;
        x0 += sw[c] * 0.92 * scale;
      }
      cx += rtl ? -(wordW[wi] + BASE * 0.45) * scale : (wordW[wi] + BASE * 0.45) * scale;
    }
  };

  const blowAway = (w: number, h: number) => {
    oax.clearRect(0, 0, 2048, 1024);
    oax.drawImage(atlas, 0, 0);
    fn = n;
    for (let i = 0; i < n; i++) {
      fx[i] = px[i]; fy[i] = py[i]; fr[i] = rot[i];
      const a = Math.atan2(py[i] - h / 2, px[i] - w / 2) + (hash1(i) - 0.5);
      const v = Math.min(w, h) * (1.5 + hash1(i + 3) * 2);
      fvx[i] = Math.cos(a) * v; fvy[i] = Math.sin(a) * v - v * 0.3; fvr[i] = (hash1(i + 5) - 0.5) * 14;
      fsx[i] = sx[i]; fsy[i] = sy[i]; fsw[i] = sw[i]; fsh[i] = sh[i];
    }
    fly = 1.6;
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      let changed = lyr.update(env, t, s);
      if (sec.hit(s) && sec.big) { blowAway(w, h); lyr.set(lyr.text, t, lyr.real, lyr.which); changed = true; }
      if (changed || w !== wFor || h !== hFor) { wFor = w; hFor = h; compose(w, h); }
      fly = Math.max(0, fly - dt);

      const k = Math.min(w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#1a1714";
      ctx.fillRect(0, 0, w, h);
      // a folha
      const z = 1 + 0.03 * s.bass + 0.01 * s.beat;
      ctx.setTransform(z, 0, 0, z, (w - w * z) / 2, (h - h * z) / 2);
      ctx.fillStyle = "#ece6d6";
      ctx.fillRect(w * 0.03, h * 0.05, w * 0.94, h * 0.9);
      ctx.fillStyle = env.colors[0];
      ctx.globalAlpha = 0.12;
      ctx.fillRect(w * 0.03, h * 0.05, w * 0.94, h * 0.9);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(60,90,160,.18)";
      for (let y = h * 0.12; y < h * 0.95; y += k * 0.06) ctx.fillRect(w * 0.03, y, w * 0.94, 1);
      ctx.fillStyle = "rgba(200,40,60,.25)";
      ctx.fillRect(w * 0.1, h * 0.05, 1.5, h * 0.9);
      const shown = lyr.shown(t, env);
      const jig = s.beat * 0.05;
      for (let i = 0; i < n; i++) {
        const wi = wordOf[i];
        if (wi >= shown) continue;
        const a = env.reduceMotion ? 1 : clamp((t - lyr.starts[wi]) / 0.22);
        const e = easeOutBack(a);
        const sc = scale * (1 + (1 - e) * 0.9);
        const r = rot[i] * (0.4 + 0.6 * e) + (1 - e) * 0.6 + jig * (hash1(i + Math.floor(t * 8)) - 0.5);
        const c = Math.cos(r) * sc, sn = Math.sin(r) * sc;
        ctx.setTransform(c * z, sn * z, -sn * z, c * z, px[i] * z + (w - w * z) / 2, py[i] * z + (h - h * z) / 2);
        ctx.globalAlpha = Math.min(1, a * 3);
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.fillRect(-sw[i] / 2 + 5, -sh[i] / 2 + 7, sw[i], sh[i]);
        ctx.drawImage(atlas, sx[i], sy[i], sw[i], sh[i], -sw[i] / 2, -sh[i] / 2, sw[i], sh[i]);
      }
      ctx.globalAlpha = 1;
      // a carta anterior a voar
      if (fly > 0) {
        for (let i = 0; i < fn; i++) {
          fvy[i] += k * 2.5 * dt;
          fx[i] += fvx[i] * dt; fy[i] += fvy[i] * dt; fr[i] += fvr[i] * dt;
          const c = Math.cos(fr[i]) * scale, sn = Math.sin(fr[i]) * scale;
          ctx.setTransform(c, sn, -sn, c, fx[i], fy[i]);
          ctx.drawImage(old, fsx[i], fsy[i], fsw[i], fsh[i], -fsw[i] / 2, -fsh[i] / 2, fsw[i], fsh[i]);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
});
