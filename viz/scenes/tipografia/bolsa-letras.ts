/**
 * Bolsa de letras: um terminal de bolsa em que as palavras da letra são
 * acções. Uma vela por batida no gráfico (a energia sobe e desce a cotação),
 * as palavras da linha cotadas à direita, a fita a correr em baixo com as
 * cotações e a "última hora" com a linha que está a tocar. Os graves
 * esticam as velas; na queda a bolsa dispara (ou cai a pique) com o letreiro
 * a piscar. Sem letra: o título e o artista são as acções.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { Lyric, MONO, SANS, hash1, titleOf, artistOf, upper } from "./_lib";

const NC = 72;
const NT = 8;

export default canvasScene({
  id: "bolsa-letras",
  name: "Bolsa de letras",
  names: { en: "Lyric stock market", lv: "Vārdu birža" },
  families: ["electronic", "chaos"],
  tags: ["texto", "letra", "dados", "gráfico", "terminal"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric(6);
  const beat = new BeatEdge(1);
  const sec = new SectionEdge();
  const o = new Float32Array(NC), c = new Float32Array(NC), hi = new Float32Array(NC), lo = new Float32Array(NC);
  let head = 0, price = 100, curHi = 100, curLo = 100, curOpen = 100, filled = 0;
  const tick: string[] = new Array(NT).fill("");
  const tickP: string[] = new Array(NT).fill("");
  const tickC: string[] = new Array(NT).fill("");
  const tickUp = new Uint8Array(NT);
  const tickBase = new Float32Array(NT);
  let tape = "", news = "", tapeW = 0, tapeX = 0, priceStr = "100,00", chgStr = "+0,00%", up = true, banner = 0, bannerUp = true;
  let titleStr = "OMS", fBig = "", fMid = "", fSmall = "", fTape = "", fBanner = "", wFor = 0, hFor = 0, title = "";
  const fmt = (v: number) => v.toFixed(2).replace(".", ",");

  const rebuild = (env: { title: string; artist: string }) => {
    const ws: string[] = [];
    for (let i = 0; i < lyr.n && ws.length < NT; i++) if (lyr.words[i].length > 1) ws.push(upper(lyr.words[i]).replace(/[.,!?;:«»"]/g, ""));
    for (const hl of lyr.hist) for (const w of hl.split(/\s+/)) if (ws.length < NT && w.length > 2) ws.push(upper(w).replace(/[.,!?;:«»"]/g, ""));
    if (ws.length < NT) ws.push(upper(titleOf(env as never)));
    if (ws.length < NT) ws.push(upper(artistOf(env as never)));
    for (let i = 0; i < NT; i++) {
      tick[i] = (ws[i] ?? "").slice(0, 14);
      tickBase[i] = 5 + hash1(tick[i].length * 13 + i) * 90;
    }
    news = lyr.real ? `ÚLTIMA HORA  «${lyr.text}»` : `EM DIRECTO  ${upper(titleOf(env as never))} · ${upper(artistOf(env as never))}`;
    tape = "";
    for (let i = 0; i < NT; i++) if (tick[i]) tape += `${tick[i]} ${tickUp[i] ? "▲" : "▼"} ${fmt(tickBase[i])}     `;
    tapeW = 0;
    titleStr = upper(titleOf(env as never)).slice(0, 18);
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h);
      if (w !== wFor || h !== hFor) {
        wFor = w; hFor = h;
        fBig = `800 ${Math.round(k * 0.075)}px ${MONO}`;
        fMid = `700 ${Math.round(k * 0.034)}px ${MONO}`;
        fSmall = `600 ${Math.round(k * 0.026)}px ${MONO}`;
        fTape = `700 ${Math.round(k * 0.04)}px ${MONO}`;
        fBanner = `900 ${Math.round(k * 0.22)}px ${SANS}`;
        tapeW = 0;
        // um histórico inventado para o gráfico nunca começar vazio
        let v = 95;
        for (let i = 0; i < NC; i++) {
          const nv = v + (hash1(i * 1.7) - 0.48) * 6;
          o[i] = v; c[i] = nv; hi[i] = Math.max(v, nv) + hash1(i) * 2; lo[i] = Math.min(v, nv) - hash1(i + 9) * 2;
          v = nv;
        }
        head = 0; filled = NC; price = curOpen = curHi = curLo = v;
      }
      if (lyr.update(env, t, s) || title !== env.title) { title = env.title; rebuild(env); }
      // a vela que está a formar-se
      const target = 100 + (s.energy - 0.45) * 60 + s.sectionIntensity * 30;
      price += (target - price) * Math.min(1, dt * 3) + (hash1(t * 60) - 0.5) * (0.5 + 4 * s.bass);
      curHi = Math.max(curHi, price); curLo = Math.min(curLo, price);
      if (beat.hit(s)) {
        o[head] = curOpen; c[head] = price; hi[head] = curHi + s.bass * 3; lo[head] = curLo - s.bass * 3;
        head = (head + 1) % NC; filled = Math.min(NC, filled + 1);
        up = price >= curOpen;
        chgStr = `${up ? "+" : ""}${fmt(((price - curOpen) / curOpen) * 100)}%`;
        priceStr = fmt(price * 10);
        curOpen = curHi = curLo = price;
        for (let i = 0; i < NT; i++) {
          const ch = (hash1(i * 7 + t) - 0.5) * 6 * (0.3 + s.energy);
          tickBase[i] = Math.max(0.5, tickBase[i] * (1 + ch / 100));
          tickUp[i] = ch >= 0 ? 1 : 0;
          tickP[i] = fmt(tickBase[i]);
          tickC[i] = `${ch >= 0 ? "▲" : "▼"}${fmt(Math.abs(ch))}%`;
        }
      }
      if (sec.hit(s) && sec.big) { banner = 1; bannerUp = hash1(s.sectionIndex) > 0.3; }
      if (s.drop > 0.95) banner = 1;
      banner = Math.max(0, banner - dt * 0.4);

      const GREEN = "#29e07a", RED = "#ff3b4e", AMBER = "#ffb000";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, w, h);
      const m = k * 0.04;
      const chartX = m, chartY = h * 0.17, chartW = w * 0.66, chartH = h * 0.56;
      // grelha
      ctx.fillStyle = "#121821";
      for (let i = 0; i <= 6; i++) ctx.fillRect(chartX, chartY + (chartH * i) / 6, chartW, 1);
      for (let i = 0; i <= 10; i++) ctx.fillRect(chartX + (chartW * i) / 10, chartY, 1, chartH);
      // escala
      let mn = 1e9, mx = -1e9;
      for (let i = 0; i < filled; i++) { const j = (head - 1 - i + NC) % NC; mn = Math.min(mn, lo[j]); mx = Math.max(mx, hi[j]); }
      mn = Math.min(mn, curLo, price) - 2; mx = Math.max(mx, curHi, price) + 2;
      const Y = (v: number) => chartY + chartH - ((v - mn) / (mx - mn)) * chartH;
      const cw = chartW / NC;
      for (let i = 0; i <= filled; i++) {
        const live = i === 0;
        const j = (head - i + NC) % NC;
        const oo = live ? curOpen : o[j], cc = live ? price : c[j], hh = live ? curHi : hi[j], ll = live ? curLo : lo[j];
        const x = chartX + chartW - (i + 1) * cw;
        if (x < chartX) break;
        const g = cc >= oo;
        ctx.fillStyle = g ? GREEN : RED;
        ctx.fillRect(x + cw * 0.45, Y(hh), Math.max(1, cw * 0.1), Y(ll) - Y(hh));
        const top = Y(Math.max(oo, cc)), bot = Y(Math.min(oo, cc));
        ctx.globalAlpha = live ? 0.6 + 0.4 * s.beat : 1;
        ctx.fillRect(x + cw * 0.15, top, cw * 0.7, Math.max(2, bot - top));
        ctx.globalAlpha = 1;
      }
      // média móvel nas cores da capa
      ctx.strokeStyle = env.colors[0];
      ctx.lineWidth = Math.max(1.5, k * 0.003);
      ctx.beginPath();
      let acc = 0, started = false;
      for (let i = filled - 1; i >= 0; i--) {
        const j = (head - 1 - i + NC) % NC;
        acc = acc ? acc * 0.8 + c[j] * 0.2 : c[j];
        const x = chartX + chartW - (i + 1.5) * cw;
        if (!started) { ctx.moveTo(x, Y(acc)); started = true; } else ctx.lineTo(x, Y(acc));
      }
      ctx.stroke();
      // a cotação em cima
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.font = fMid;
      ctx.fillStyle = AMBER;
      ctx.fillText("OMS·BOLSA  ÍNDICE", m, m * 0.8);
      ctx.font = fBig;
      ctx.fillStyle = "#e8edf2";
      ctx.fillText(titleStr, m, m * 0.8 + k * 0.042, w * 0.5);
      ctx.textAlign = "right";
      ctx.fillStyle = up ? GREEN : RED;
      ctx.fillText(priceStr, chartX + chartW, m * 0.8 + k * 0.042);
      ctx.font = fMid;
      ctx.fillText(chgStr, chartX + chartW, m * 0.8);
      // as acções (palavras) à direita
      const lx = w * 0.72, lw = w - lx - m;
      ctx.textAlign = "left";
      ctx.font = fSmall;
      ctx.fillStyle = AMBER;
      ctx.fillText("ACÇÃO        COT.    VAR.", lx, chartY - k * 0.045, lw);
      for (let i = 0; i < NT; i++) {
        if (!tick[i]) continue;
        const y = chartY + (chartH * i) / NT;
        const hot = i < lyr.shown(t, env) && lyr.real && i < lyr.n;
        ctx.fillStyle = hot ? "#1a2533" : "#0b1017";
        ctx.fillRect(lx, y, lw, chartH / NT - 3);
        ctx.font = fMid;
        ctx.fillStyle = hot ? "#fff" : "#9fb0c0";
        ctx.fillText(tick[i], lx + k * 0.01, y + k * 0.012, lw * 0.5);
        ctx.font = fSmall;
        ctx.textAlign = "right";
        ctx.fillStyle = "#c8d2dc";
        ctx.fillText(tickP[i], lx + lw * 0.75, y + k * 0.016);
        ctx.fillStyle = tickUp[i] ? GREEN : RED;
        ctx.fillText(tickC[i], lx + lw - k * 0.01, y + k * 0.016);
        ctx.textAlign = "left";
      }
      // última hora e fita
      const ny = chartY + chartH + k * 0.04;
      ctx.fillStyle = env.colors[1];
      ctx.fillRect(0, ny, w, k * 0.065);
      ctx.font = fMid;
      ctx.fillStyle = "#fff";
      ctx.fillText(news, m, ny + k * 0.015, w - m * 2);
      ctx.font = fTape;
      if (!tapeW && tape) tapeW = ctx.measureText(tape).width;
      const ty = h - k * 0.09;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, ty - k * 0.015, w, k * 0.08);
      tapeX -= dt * k * (0.15 + 0.25 * s.energy);
      if (tapeW && tapeX < -tapeW) tapeX += tapeW;
      ctx.fillStyle = AMBER;
      if (tapeW) for (let x = tapeX; x < w; x += tapeW) ctx.fillText(tape, x, ty);
      // o letreiro grande na queda
      if (banner > 0.01) {
        const on = Math.floor(t * 8) % 2 === 0 || banner < 0.5;
        ctx.save();
        ctx.translate(w / 2, h * 0.45);
        ctx.rotate(-0.12);
        ctx.globalAlpha = Math.min(1, banner * 2);
        ctx.font = fBanner;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = on ? (bannerUp ? GREEN : RED) : "#fff";
        ctx.fillText(bannerUp ? "DISPARA ▲" : "CRASH ▼", 0, 0, w * 0.95);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    },
  };
});
