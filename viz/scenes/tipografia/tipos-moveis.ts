/**
 * Tipos móveis: um cartaz de tipografia de madeira composto à frente de
 * quem vê. Cada palavra desce em blocos de madeira com as letras ao
 * contrário, bate no papel na hora em que é cantada (o prelo dá um baque) e
 * levanta-se deixando a impressão com a tinta falhada. Cada linha da letra
 * é uma fiada noutro tipo e noutra cor; a folha cheia sai e entra outra.
 * Na queda, o título em vermelho a toda a largura.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { clamp, easeInQuad } from "../../lib/ease";
import { Lyric, SANS, SERIF, WIDE, hash1, titleOf, units, upper } from "./_lib";

const FONTS = [(px: number) => `${px}px ${WIDE}`, (px: number) => `900 ${px}px ${SANS}`, (px: number) => `700 ${px}px ${SERIF}`];

interface Word { text: string; us: string[]; f: string; x: number; y: number; size: number; font: number; sx: number; at: number; done: boolean; ink: string }

export default canvasScene({
  id: "tipos-moveis",
  name: "Tipos móveis",
  names: { en: "Wood type", lv: "Koka burti" },
  families: ["retro", "chaos"],
  tags: ["tipografia", "papel", "tinta", "cartaz", "madeira", "letra"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const thump = new Envelope(0.004, 0.12);
  const poster = document.createElement("canvas"), px = poster.getContext("2d")!;
  const old = document.createElement("canvas"), ox = old.getContext("2d")!;
  const tmp = document.createElement("canvas"), tx = tmp.getContext("2d")!;
  const speck = document.createElement("canvas"), spx = speck.getContext("2d")!;
  const wood = document.createElement("canvas"), wx = wood.getContext("2d")!;
  let woodPat: CanvasPattern | null = null;
  const words: Word[] = [];
  let rowY = 0, wFor = 0, hFor = 0, slide = 1, m = 0, style = 0, headerPending = true;

  const paperFill = (x: CanvasRenderingContext2D, w: number, h: number) => {
    x.fillStyle = "#efe6d2";
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = hash1(i) > 0.5 ? "rgba(110,90,60,.05)" : "rgba(255,255,255,.1)";
      x.fillRect(hash1(i * 1.3) * w, hash1(i * 2.9) * h, 1 + hash1(i * 4.1) * 4, 1 + hash1(i * 5.3) * 2);
    }
  };

  const setup = (w: number, h: number, ctx: CanvasRenderingContext2D) => {
    for (const c of [poster, old, tmp]) { c.width = w; c.height = h; }
    paperFill(px, w, h);
    speck.width = speck.height = 256;
    for (let i = 0; i < 2600; i++) { spx.fillStyle = `rgba(0,0,0,${0.3 + hash1(i * 7) * 0.7})`; spx.fillRect(hash1(i) * 256, hash1(i + 0.3) * 256, 1 + hash1(i * 3) * 3, 1 + hash1(i * 5) * 2); }
    wood.width = 128; wood.height = 128;
    wx.fillStyle = "#b07a46";
    wx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { wx.fillStyle = `rgba(${70 + hash1(i) * 40},${40 + hash1(i + 1) * 20},20,${0.15 + hash1(i * 2) * 0.25})`; wx.fillRect(0, hash1(i * 3) * 128, 128, 1 + hash1(i * 4) * 3); }
    woodPat = ctx.createPattern(wood, "repeat");
    m = Math.min(w, h) * 0.06;
    rowY = m;
    headerPending = true;
    words.length = 0;
    wFor = w; hFor = h;
  };

  const newSheet = () => {
    ox.drawImage(poster, 0, 0);
    paperFill(px, poster.width, poster.height);
    rowY = m;
    slide = 0;
    headerPending = true;
  };

  /** Uma fiada nova: a linha inteira a toda a largura, as palavras com as suas horas. */
  const addRow = (text: string, starts: Float32Array, n: number, ws: string[], t: number, ctx: CanvasRenderingContext2D, ink: string, big = false) => {
    const w = poster.width, h = poster.height, pw = w - m * 2;
    const fi = big ? 0 : style % FONTS.length;
    const font = FONTS[fi];
    ctx.font = font(100);
    const line = upper(text);
    const lw = Math.max(1, ctx.measureText(line).width);
    let size = Math.min((100 * pw) / lw, h * (big ? 0.3 : 0.2));
    let sx = 1;
    if (size < h * 0.07) { sx = Math.max(0.55, size / (h * 0.07)); size = Math.min(h * 0.07, (100 * pw) / (lw * sx)); }
    if (rowY + size * 0.95 > h - m) newSheet();
    ctx.font = font(size);
    const rtl = /[֐-ࣿ]/.test(line);
    const gap = ctx.measureText(" ").width * sx;
    let tw = 0;
    const widths: number[] = [];
    for (let i = 0; i < n; i++) { const ww = ctx.measureText(upper(ws[i])).width * sx; widths.push(ww); tw += ww + (i ? gap : 0); }
    let x = w / 2 - tw / 2;
    if (rtl) x = w / 2 + tw / 2;
    for (let i = 0; i < n; i++) {
      const wx0 = rtl ? x - widths[i] : x;
      words.push({ text: upper(ws[i]), us: units(upper(ws[i])), f: font(size), x: wx0, y: rowY + size * 0.82, size, font: fi, sx, at: starts[i] + 0.28, done: false, ink });
      x += rtl ? -(widths[i] + gap) : widths[i] + gap;
    }
    rowY += size * 0.95;
    void t;
  };

  const print = (wd: Word) => {
    tx.clearRect(0, 0, tmp.width, tmp.height);
    tx.save();
    tx.font = wd.f;
    tx.textBaseline = "alphabetic";
    tx.translate(wd.x, wd.y);
    tx.scale(wd.sx, 1);
    tx.fillStyle = wd.ink;
    tx.fillText(wd.text, 0, 0);
    tx.restore();
    // a tinta falhada: picotar com o padrão
    tx.globalCompositeOperation = "destination-out";
    tx.globalAlpha = 0.55;
    const ofs = hash1(wd.x) * 256;
    for (let yy = -ofs; yy < tmp.height; yy += 256) for (let xx = -ofs; xx < tmp.width; xx += 256) tx.drawImage(speck, xx, yy);
    tx.globalAlpha = 1;
    tx.globalCompositeOperation = "source-over";
    px.globalCompositeOperation = "multiply";
    px.drawImage(tmp, 0, 0);
    px.globalCompositeOperation = "source-over";
    wd.done = true;
    thump.kick(1);
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      if (w !== wFor || h !== hFor) setup(w, h, ctx);
      const inks = env.colors;
      if (headerPending) {
        // cada folha começa com o título em cima, já impresso
        headerPending = false;
        const tt = titleOf(env);
        const ws = tt.split(/\s+/).filter(Boolean);
        const st = new Float32Array(ws.length).fill(t - 1);
        style++;
        addRow(tt, st, ws.length, ws, t, ctx, inks[2], true);
        rowY += m * 0.3;
      }
      if (sec.hit(s)) {
        style++;
        if (sec.big) {
          const tt = titleOf(env);
          const ws = tt.split(/\s+/).filter(Boolean);
          const st = new Float32Array(ws.length);
          for (let i = 0; i < ws.length; i++) st[i] = t + i * 0.12;
          addRow(tt, st, ws.length, ws, t, ctx, "#c8102e", true);
        }
      }
      if (lyr.update(env, t, s)) addRow(lyr.text, lyr.starts, lyr.n, lyr.words, t, ctx, lyr.serial % 4 === 0 ? "#1b1820" : inks[lyr.serial % 3]);
      for (const wd of words) if (!wd.done && (t >= wd.at || env.reduceMotion)) print(wd);
      while (words.length && words[0].done && t - words[0].at > 1.5) words.shift();
      if (s.beat > 0.9) thump.kick(0.35);
      thump.step(0, dt);
      slide = Math.min(1, slide + dt * 1.4);

      const k = Math.min(w, h);
      const sh = thump.v * k * 0.006;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#2a2420";
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, sh);
      if (slide < 1) {
        const e = easeInQuad(slide);
        ctx.drawImage(old, 0, -e * h * 1.1);
        ctx.drawImage(poster, 0, h * (1 - Math.min(1, slide * 1.2)) * 1.05);
      } else ctx.drawImage(poster, 0, 0);
      // os blocos no ar: descem, batem, sobem
      for (const wd of words) {
        const a = t - (wd.at - 0.28);
        if (a < -0.05 || a > 0.75 || env.reduceMotion) continue;
        const down = a < 0.28 ? 1 - easeInQuad(clamp(a / 0.28)) : clamp((a - 0.36) / 0.4);
        const lift = down * h * 0.5;
        const us = wd.us;
        ctx.font = wd.f;
        let x = wd.x;
        for (let i = 0; i < us.length; i++) {
          const u = us[i];
          const uw = ctx.measureText(u).width * wd.sx;
          if (u.trim()) {
            const bx = x, by = wd.y - wd.size * 0.82 - lift - wd.size * 0.12, bh = wd.size * 1.02;
            ctx.fillStyle = "rgba(0,0,0,.35)";
            ctx.fillRect(bx + k * 0.012 * (1 + down * 3), by + k * 0.02 * (1 + down * 3), uw, bh);
            ctx.fillStyle = woodPat!;
            ctx.fillRect(bx, by, uw, bh);
            ctx.strokeStyle = "#6b4526"; ctx.lineWidth = 1;
            ctx.strokeRect(bx + 0.5, by + 0.5, uw - 1, bh - 1);
            // a letra em relevo, ao espelho e com tinta
            ctx.save();
            ctx.translate(bx + uw, wd.y - lift);
            ctx.scale(-wd.sx, 1);
            ctx.fillStyle = wd.ink;
            ctx.fillText(u, 0, 0);
            ctx.restore();
          }
          x += uw;
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // o rolo da tinta a passar na batida
      ctx.fillStyle = inks[1];
      ctx.globalAlpha = 0.25 * s.beat;
      ctx.fillRect(0, 0, w, h * 0.02);
      ctx.globalAlpha = 1;
    },
  };
});
