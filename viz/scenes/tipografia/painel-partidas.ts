/**
 * Painel de partidas: o quadro de palhetas de um aeroporto. Cada linha da
 * letra entra como um destino e as palhetas giram até à letra certa, em
 * cascata; as linhas antigas descem e "partem". O estado muda com a secção
 * (embarque, última chamada, partiu...), a batida faz saltar palhetas
 * soltas, a queda baralha o quadro inteiro. Sem letra: título e artista.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { JOIN_RE, Lyric, SANS, artistOf, hash1, titleOf, units, upper } from "./_lib";

const BASE = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-'!?,";
const MAX_GLYPHS = 220;
const PER_ROW = 16;
const BG = "#050506";
const STATUS: Record<string, string> = {
  none: "A EMBARCAR", intro: "A EMBARCAR", verse: "EMBARQUE", build: "ÚLTIMA CHAMADA", drop: "PARTIU",
  chorus: "A DESCOLAR", high: "EM VOO", breakdown: "ATRASADO", outro: "ATERROU",
};

export default canvasScene({
  id: "painel-partidas",
  name: "Painel de partidas",
  names: { en: "Departures board", lv: "Izlidošanas tablo" },
  families: ["retro", "electronic"],
  tags: ["texto", "letra", "aeroporto", "mecânico", "viagem"],
  intensity: 2,
  cost: 1,
  signals: ["beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric(10);
  const beat = new BeatEdge(1);
  const sec = new SectionEdge();
  const glyphs = new Map<string, number>();
  const chars: string[] = [];
  const atlas = document.createElement("canvas");
  const ax = atlas.getContext("2d")!;
  let cols = 0, rows = 0, cw = 0, ch = 0, ox = 0, oy = 0, gapX = 0, gapY = 0, built = false, wFor = 0, hFor = 0;
  let cur = new Int16Array(0), tgt = new Int16Array(0), yel = new Uint8Array(0);
  let next = new Float32Array(0), steps = new Uint8Array(0);
  let rowText: string[] = [];
  let destCols = 0, status = "";
  let lineStarts: number[] = [];
  // o que está pintado no canvas, célula a célula (-1: por pintar)
  let drawnG = new Int16Array(0), drawnY = new Uint8Array(0), drawnP = new Uint8Array(0);
  let drawnRow: string[] = [];
  let full = true;

  const slot = (c: string) => {
    let i = glyphs.get(c);
    if (i !== undefined) return i;
    if (chars.length >= MAX_GLYPHS) return 0;
    i = chars.length;
    chars.push(c);
    glyphs.set(c, i);
    drawGlyph(i);
    return i;
  };
  // O atlas é uma grelha (PER_ROW palhetas por linha, cada uma com a versão
  // branca e a amarela uma por baixo da outra): uma tira de 220 palhetas
  // tinha ~10 000 px de largura, acima do que o WebKit do iPhone aguenta numa
  // textura, e cada drawImage dela ia pelo processador.
  const gx = (i: number) => (i % PER_ROW) * cw;
  const gy = (i: number, v: number) => (Math.floor(i / PER_ROW) * 2 + v) * ch;
  const drawGlyph = (i: number) => {
    for (let v = 0; v < 2; v++) {
      const x = gx(i), y = gy(i, v);
      ax.save();
      ax.beginPath();
      ax.rect(x, y, cw, ch);
      ax.clip();
      ax.clearRect(x, y, cw, ch);
      ax.fillStyle = "#151517";
      ax.beginPath();
      ax.roundRect(x + 0.5, y + 0.5, cw - 1, ch - 1, cw * 0.1);
      ax.fill();
      ax.fillStyle = "#1f1f22";
      ax.fillRect(x + 1, y + 1, cw - 2, ch / 2 - 1);
      ax.fillStyle = v ? "#ffcf2e" : "#f1efe8";
      ax.font = `700 ${Math.round(ch * 0.64)}px ${SANS}`;
      ax.textAlign = "center";
      ax.textBaseline = "middle";
      const c = chars[i];
      const mw = ax.measureText(c).width;
      const sx = mw > cw * 0.9 ? (cw * 0.9) / mw : 1;
      ax.save();
      ax.translate(x + cw / 2, y + ch * 0.54);
      ax.scale(sx, 1);
      ax.fillText(c, 0, 0);
      ax.restore();
      ax.fillStyle = "#000";
      ax.fillRect(x, y + ch / 2 - Math.max(1, ch * 0.025), cw, Math.max(1.5, ch * 0.05));
      ax.restore();
    }
  };

  const build = (w: number, h: number) => {
    cols = Math.max(16, Math.min(30, Math.round((w / h) * 13)));
    cw = (w * 0.94) / (cols * 1.08);
    gapX = cw * 0.08;
    ch = cw * 1.5;
    gapY = ch * 0.18;
    rows = Math.max(6, Math.min(12, Math.floor((h * 0.9) / (ch + gapY))));
    if (rows * (ch + gapY) > h * 0.92) { ch = (h * 0.92) / rows - gapY; cw = ch / 1.5; }
    ox = (w - cols * (cw + gapX)) / 2;
    oy = (h - rows * (ch + gapY)) / 2;
    atlas.width = Math.ceil(cw * PER_ROW);
    atlas.height = Math.ceil(ch * 2 * Math.ceil(MAX_GLYPHS / PER_ROW));
    glyphs.clear();
    chars.length = 0;
    for (const c of BASE) slot(c);
    const n = cols * rows;
    cur = new Int16Array(n); tgt = new Int16Array(n); yel = new Uint8Array(n);
    next = new Float32Array(n); steps = new Uint8Array(n);
    drawnG = new Int16Array(n).fill(-1); drawnY = new Uint8Array(n); drawnP = new Uint8Array(n);
    drawnRow = new Array(rows).fill("\u0000");
    full = true;
    rowText = new Array(rows).fill("");
    destCols = cols - 9;
    built = true; wFor = w; hFor = h;
  };

  const setRow = (r: number, text: string, yellow: boolean, t: number) => {
    if (r < 0 || r >= rows) return;
    rowText[r] = text;
    const us = JOIN_RE.test(text) ? [text] : units(text);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const g = c < us.length && us.length > 1 ? slot(us[c]) : c === 0 && us.length === 1 ? slot(us[0]) : 0;
      yel[i] = yellow ? 1 : 0;
      if (g !== tgt[i]) {
        tgt[i] = g;
        next[i] = t + c * 0.025 + r * 0.06 + hash1(i + t) * 0.08;
        steps[i] = 0;
      }
    }
  };
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  const padL = (s: string, n: number) => (s.length >= n ? s.slice(-n) : " ".repeat(n - s.length) + s);
  const clock = (sec: number) => { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`; };

  /** Partir o texto em pedaços de `n` letras, pelas palavras. */
  const chunks = (text: string, n: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const w of text.split(/\s+/).filter(Boolean)) {
      let ww = w;
      while (ww.length > n) { if (cur) { out.push(cur); cur = ""; } out.push(ww.slice(0, n)); ww = ww.slice(n); }
      const nx = cur ? `${cur} ${ww}` : ww;
      if (nx.length > n) { out.push(cur); cur = ww; } else cur = nx;
    }
    if (cur) out.push(cur);
    return out;
  };

  const layoutBoard = (t: number, s: { section: string; time: number }, env: { title: string; artist: string }) => {
    setRow(0, pad("PARTIDAS", cols - 6) + padL(clock(s.time), 6), true, t);
    const body = rows - 2;
    let r = 1;
    const all = [lyr.text, ...lyr.hist];
    for (let k = 0; k < all.length && r <= body; k++) {
      const line = upper(all[k]);
      const rtl = /[֐-ࣿ]/.test(line);
      const parts = JOIN_RE.test(line) || rtl ? [line] : chunks(line, destCols);
      const code = upper((titleOf(env as never).replace(/[^A-Za-z]/g, "") + "OMS").slice(0, 2)) + String(100 + ((lyr.serial - k) * 37) % 900).slice(0, 3);
      const when = clock(Math.max(0, lineStarts[k] ?? s.time));
      const gate = String(1 + (Math.abs(lyr.serial - k) * 7) % 48).padStart(2, "0");
      for (let p = 0; p < parts.length && r <= body; p++, r++) {
        if (parts.length === 1 && (JOIN_RE.test(line) || rtl)) {
          setRow(r, p === 0 ? `${when} ${code}` : "", k === 0, t);
          rowText[r] = `${when} ${code}|${line}`;
        } else setRow(r, (p === 0 ? `${when} ` : "      ") + pad(parts[p], destCols) + " " + (p === 0 ? gate : "  "), k === 0, t);
      }
    }
    // o resto do quadro: voos para o título e o artista
    for (let f = 0; r <= body; r++, f++) {
      const dest = upper(f % 2 === 0 ? titleOf(env as never) : artistOf(env as never));
      if (JOIN_RE.test(dest) || /[\u0590-\u08FF]/.test(dest)) { setRow(r, `--:-- OMS${f}`, false, t); rowText[r] = `--:-- OMS${f}|${dest}`; continue; }
      setRow(r, "--:-- " + pad(chunks(dest, destCols)[0] ?? "", destCols) + " " + String(10 + f * 3).slice(-2), false, t);
    }
    status = STATUS[s.section] ?? "EMBARQUE";
    setRow(rows - 1, pad(`${lyr.real ? "" : upper(artistOf(env as never)) + " "}`, 0) + padL(status, cols), false, t);
  };

  return {
    reset() { built = false; full = true; },
    frame(ctx, w, h, dt, t, s, env) {
      if (!built || w !== wFor || h !== hFor) { build(w, h); layoutBoard(t, s, env); }
      const changed = lyr.update(env, t, s);
      if (changed) { lineStarts.unshift(s.time); if (lineStarts.length > 12) lineStarts.length = 12; layoutBoard(t, s, env); }
      const secHit = sec.hit(s);
      if (secHit) {
        layoutBoard(t, s, env);
        if (sec.big) for (let i = cols; i < cur.length; i++) { cur[i] = (cur[i] + 7 + (i % 11)) % BASE.length; next[i] = t + hash1(i) * 0.6; steps[i] = 0; }
      }
      if (beat.hit(s)) {
        // relógio do topo e umas palhetas soltas que dão a volta
        setRow(0, pad("PARTIDAS", cols - 6) + padL(clock(s.time), 6), true, t);
        for (let k = 0; k < 2 + Math.round(4 * s.bass); k++) {
          const i = cols + Math.floor(hash1(t * 13 + k) * (cur.length - cols * 2));
          if (cur[i] === tgt[i] && tgt[i] !== 0) { cur[i] = (tgt[i] + BASE.length - 3) % BASE.length; next[i] = t; }
        }
      }

      // Só se pinta o que mexe: o quadro fica no canvas de um frame para o
      // outro (o motor não o limpa) e cada frame redesenha as réguas e as
      // palhetas a virar ou que mudaram. Parado, são duas réguas por frame.
      if (full) {
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, w, h);
        drawnG.fill(-1);
        drawnRow.fill("\u0000");
        full = false;
      }
      // moldura e réguas entre as linhas
      const rx = ox - gapX * 2, rw = cols * (cw + gapX) + gapX * 3;
      const r1 = oy + ch + gapY / 2 - 1, r2 = oy + (rows - 1) * (ch + gapY) - gapY / 2 - 1;
      ctx.fillStyle = BG;
      ctx.fillRect(rx, r1 - 1, rw, 4);
      ctx.fillRect(rx, r2 - 1, rw, 4);
      ctx.fillStyle = env.colors[0];
      ctx.globalAlpha = 0.25 + 0.25 * s.beat;
      ctx.fillRect(rx, r1, rw, 2);
      ctx.fillRect(rx, r2, rw, 2);
      ctx.globalAlpha = 1;

      const STEP = 0.055;
      const hh = ch / 2;
      for (let r = 0; r < rows; r++) {
        const y = oy + r * (ch + gapY);
        const rt = rowText[r];
        // o letreiro mudou (ou deixou de existir): a linha inteira volta a pintar-se
        if (rt !== drawnRow[r]) for (let c = 0; c < cols; c++) drawnG[r * cols + c] = -1;
        let rowDirty = rt !== drawnRow[r];
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const v = yel[i];
          let a = cur[i];
          if (a !== tgt[i] && t >= next[i]) {
            // um passo: a seguinte no ciclo, ou salta para a certa se não está no ciclo
            if (env.reduceMotion) a = tgt[i];
            else if (tgt[i] >= BASE.length || steps[i] > 24) a = tgt[i];
            else a = (a + 1) % BASE.length;
            cur[i] = a; steps[i]++;
            next[i] = t + STEP;
          }
          const flipping = !env.reduceMotion && (a !== tgt[i] || t < next[i]);
          const p = flipping ? Math.min(1, Math.max(0, 1 - (next[i] - t) / STEP)) : 1;
          const settled = p >= 1;
          // parada e igual ao que já está no canvas: nada a fazer
          if (settled && drawnG[i] === a && drawnY[i] === v && drawnP[i] >= 1) continue;
          const x = ox + c * (cw + gapX);
          rowDirty = true;
          drawnG[i] = a; drawnY[i] = v; drawnP[i] = settled ? 1 : 0;
          ctx.fillStyle = BG;
          ctx.fillRect(x, y, cw, ch);
          if (settled) {
            ctx.drawImage(atlas, gx(a), gy(a, v), cw, ch, x, y, cw, ch);
            continue;
          }
          // a meio de virar: a de cima já é a nova, a de baixo ainda a velha e a palheta a cair
          const prev = a === 0 ? 0 : (a + BASE.length - 1) % BASE.length;
          ctx.drawImage(atlas, gx(a), gy(a, v), cw, hh, x, y, cw, hh);
          ctx.drawImage(atlas, gx(prev), gy(prev, v) + hh, cw, hh, x, y + hh, cw, hh);
          if (p < 0.5) {
            const k = 1 - p * 2;
            ctx.drawImage(atlas, gx(prev), gy(prev, v), cw, hh, x, y + hh * (1 - k), cw, hh * k);
          } else {
            const k = (p - 0.5) * 2;
            ctx.drawImage(atlas, gx(a), gy(a, v) + hh, cw, hh, x, y + hh, cw, hh * k);
          }
        }
        drawnRow[r] = rt;
        // linhas em escritas que não se partem letra a letra: o destino inteiro, num só letreiro
        const bar = rt.indexOf("|");
        if (bar >= 0 && rowDirty) {
          const x0 = ox + 11 * (cw + gapX), x1 = ox + (cols - 3) * (cw + gapX);
          ctx.fillStyle = "#151517";
          ctx.fillRect(x0, y, x1 - x0, ch);
          ctx.fillStyle = r === 1 ? "#ffcf2e" : "#f1efe8";
          ctx.font = `700 ${Math.round(ch * 0.62)}px ${SANS}`;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(rt.slice(bar + 1), x1 - cw * 0.2, y + ch * 0.54, x1 - x0 - cw * 0.4);
        }
      }
    },
  };
});
