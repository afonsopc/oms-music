/**
 * Máquina de escrever: a letra batida tecla a tecla numa folha, ao ritmo das
 * palavras, com a tinta desigual de uma fita gasta. O carro corre para a
 * esquerda a cada letra e volta no fim da linha; a folha sobe. A batida faz
 * tremer o rolo, os graves carregam a tinta, nas quedas a fita passa ao
 * vermelho e as letras saem a dobrar; cada secção nova deixa "* * *".
 * Sem letra: o título e o artista à máquina. Hebraico da direita para a esquerda.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { damp } from "../../lib/ease";
import { JOIN_RE, Lyric, RTL_RE, TYPE, hash1 } from "./_lib";

const COLS = 34;

export default canvasScene({
  id: "maquina-escrever",
  name: "Máquina de escrever",
  names: { en: "Typewriter", lv: "Rakstāmmašīna" },
  families: ["retro", "chaos"],
  tags: ["texto", "letra", "papel", "mecânico", "tinta"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const jolt = new Envelope(0.004, 0.09);
  const paper = document.createElement("canvas");
  const px = paper.getContext("2d")!;
  let cw = 0, lh = 0, pw = 0, ph = 0, margin = 0, col = 0, row = 0, rtl = false;
  let queue: string[] = [];
  let qTimes: number[] = [];
  let qi = 0, carriage = 0, feed = 0, ready = false, wFor = 0;
  let ink = "#1d1a24", red = false, gradPlaten: CanvasGradient | null = null, gradShade: CanvasGradient | null = null;

  const setup = (w: number, h: number, ctx: CanvasRenderingContext2D) => {
    const k = Math.min(w, h);
    px.font = `${Math.round(k * 0.05)}px ${TYPE}`;
    cw = px.measureText("M").width;
    lh = k * 0.075;
    margin = cw * 4;
    pw = Math.ceil(COLS * cw + margin * 2);
    ph = Math.ceil(Math.max(h * 1.6, lh * 22));
    paper.width = pw; paper.height = ph;
    px.font = `${Math.round(k * 0.05)}px ${TYPE}`;
    px.textBaseline = "alphabetic";
    // folha: branco quente com fibras
    px.fillStyle = "#efe8d8";
    px.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 1400; i++) {
      px.fillStyle = hash1(i) > 0.5 ? "rgba(120,100,70,.05)" : "rgba(255,255,255,.08)";
      px.fillRect(hash1(i * 3.1) * pw, hash1(i * 7.7) * ph, 1 + hash1(i) * 3, 1);
    }
    col = 0; row = Math.floor(ph / lh) - 12; carriage = 0; feed = row;
    queue = []; qTimes = []; qi = 0;
    gradPlaten = ctx.createLinearGradient(0, 0, 0, 1);
    gradPlaten.addColorStop(0, "#0b0b0d"); gradPlaten.addColorStop(0.35, "#2a2a30"); gradPlaten.addColorStop(0.6, "#121215"); gradPlaten.addColorStop(1, "#000");
    gradShade = ctx.createLinearGradient(0, 0, 1, 0);
    gradShade.addColorStop(0, "rgba(0,0,0,.85)"); gradShade.addColorStop(0.18, "rgba(0,0,0,0)"); gradShade.addColorStop(0.82, "rgba(0,0,0,0)"); gradShade.addColorStop(1, "rgba(0,0,0,.85)");
    ready = true; wFor = w;
  };

  /** Subir a folha uma linha (se chegou ao fundo, desliza o que está escrito para cima). */
  const newline = () => {
    col = 0;
    row++;
    if ((row + 9) * lh > ph) {
      px.drawImage(paper, 0, -lh * 6);
      px.fillStyle = "#efe8d8";
      px.fillRect(0, ph - lh * 6, pw, lh * 6);
      row -= 6; feed -= 6;
    }
  };

  const strike = (c: string, t: number) => {
    if (c === "\n") { newline(); return; }
    if (col >= COLS) newline();
    if (c === " " && col === 0) return;
    const y = (row + 0.8) * lh;
    const wch = c.length > 1 ? px.measureText(c).width : cw;
    const span = Math.max(1, Math.round(wch / cw));
    const x = rtl ? pw - margin - (col + span) * cw : margin + col * cw;
    if (c !== " ") {
      const jitter = hash1(t * 91 + col);
      px.save();
      px.translate(x + (span * cw) / 2, y + (jitter - 0.5) * lh * 0.06);
      px.rotate((hash1(col + row * 17) - 0.5) * 0.05);
      px.fillStyle = red ? "#a3162a" : ink;
      px.globalAlpha = 0.55 + 0.45 * hash1(t * 13 + row);
      px.textAlign = "center";
      px.fillText(c, 0, 0);
      if (red || jitter > 0.85) { px.globalAlpha *= 0.6; px.fillText(c, 0.8, 0.4); }
      px.restore();
      jolt.kick(0.5);
    }
    col += span;
  };

  const enqueue = (t: number) => {
    // o que ficou por bater da linha anterior sai de rajada
    for (; qi < queue.length; qi++) strike(queue[qi], t);
    queue = []; qTimes = []; qi = 0;
    const text = lyr.text;
    rtl = RTL_RE.test(text);
    const join = JOIN_RE.test(text);
    if (col > 0) { queue.push("\n"); qTimes.push(t); }
    for (let i = 0; i < lyr.n; i++) {
      const wd = lyr.words[i];
      const us = join ? [wd] : Array.from(wd);
      for (let k = 0; k < us.length; k++) {
        queue.push(us[k]);
        qTimes.push(lyr.starts[i] + ((lyr.ends[i] - lyr.starts[i]) * k) / us.length);
      }
      queue.push(" "); qTimes.push(lyr.ends[i]);
    }
  };

  return {
    reset() { ready = false; },
    frame(ctx, w, h, dt, t, s, env) {
      if (!ready || w !== wFor) setup(w, h, ctx);
      if (sec.hit(s)) {
        red = sec.big;
        for (; qi < queue.length; qi++) strike(queue[qi], t);
        if (col > 0) newline();
        newline();
        col = Math.floor(COLS / 2) - 3;
        for (const c of "* * *") strike(c, t);
        newline();
      }
      if (lyr.update(env, t, s)) enqueue(t);
      const c0 = env.colorVecs[0];
      ink = `rgb(${Math.round(c0[0] * 60 + 15)},${Math.round(c0[1] * 60 + 12)},${Math.round(c0[2] * 60 + 22)})`;
      while (qi < queue.length && (qTimes[qi] <= t || env.reduceMotion)) { strike(queue[qi], t); qi++; }
      if (s.beat > 0.9) jolt.kick(0.6 + s.bass);
      jolt.step(0, dt);

      // o carro segue a cabeça de escrever; a folha sobe com as linhas
      const k = Math.min(w, h);
      const zoom = (w / (pw * 0.8)) * (1 - 0.35 * s.drop) * (1 + 0.015 * s.beat);
      const headX = rtl ? pw - margin - col * cw : margin + col * cw;
      carriage = env.reduceMotion ? headX : damp(carriage, headX, col === 0 ? 7 : 22, dt);
      feed = env.reduceMotion ? row : damp(feed, row, 9, dt);
      const shakeY = jolt.v * k * 0.004 * (hash1(t * 50) > 0.5 ? 1 : -1);
      const strikeY = h * 0.62;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0d0c0f";
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(zoom, 0, 0, zoom, w / 2 - carriage * zoom, strikeY - (feed + 0.8) * lh * zoom + shakeY);
      // sombra da folha e a folha
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(10, 14, pw, ph);
      ctx.drawImage(paper, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // o rolo e a guia da fita no ponto de batida
      const platY = strikeY + lh * zoom * 0.45 + shakeY * 2;
      ctx.setTransform(w, 0, 0, h * 0.5, 0, platY);
      ctx.fillStyle = gradPlaten!;
      ctx.fillRect(0, 0, 1, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = env.colors[1];
      ctx.globalAlpha = 0.65 + 0.35 * s.beat;
      ctx.fillRect(0, platY + h * 0.05, w, Math.max(2, h * 0.008));
      ctx.globalAlpha = 1;
      const gx = w / 2, gy = strikeY + lh * zoom * 0.2;
      ctx.fillStyle = red ? "#a3162a" : "#26232c";
      ctx.beginPath();
      ctx.moveTo(gx - cw * zoom * 1.6, platY);
      ctx.lineTo(gx - cw * zoom * 0.7, gy);
      ctx.lineTo(gx + cw * zoom * 0.7, gy);
      ctx.lineTo(gx + cw * zoom * 1.6, platY);
      ctx.fill();
      ctx.fillStyle = "#8a8790";
      ctx.fillRect(gx - cw * zoom * 0.08, gy - lh * zoom * 0.05, cw * zoom * 0.16, lh * zoom * 0.1);
      // vinheta lateral
      ctx.setTransform(w, 0, 0, h, 0, 0);
      ctx.fillStyle = gradShade!;
      ctx.fillRect(0, 0, 1, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
});
