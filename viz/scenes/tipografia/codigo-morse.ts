/**
 * Código Morse: uma lâmpada de sinais à beira-mar, de noite, a piscar o
 * título, o artista e a letra em Morse, com cada ponto e traço em cima das
 * semicolcheias da música. Em baixo a fita de papel a correr com os pontos
 * e as letras decifradas; em cima o telegrama a compor-se ("… STOP").
 * Os graves alargam o feixe, a batida faz cintilar o mar, a queda é um SOS
 * a piscar a toda a força.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { Lyric, MONO, TYPE, artistOf, titleOf } from "./_lib";

const CODE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--",
  N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "'": ".----.", "-": "-....-", "/": "-..-.", ":": "---...", "&": ".-...",
};
const codeOf = (c: string) => {
  const b = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (CODE[b]) return CODE[b];
  // outras escritas: um código de 4 a 5 sinais tirado do número da letra
  const n = c.codePointAt(0) ?? 0;
  let s = "";
  for (let i = 0; i < 4 + (n & 1); i++) s += (n >> i) & 1 ? "-" : ".";
  return s;
};

const MAXS = 400;

export default canvasScene({
  id: "codigo-morse",
  name: "Código Morse",
  names: { en: "Morse code", lv: "Morzes kods" },
  families: ["retro", "electronic"],
  tags: ["luz", "noite", "mar", "texto", "telegrama", "ritmo"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  // a mensagem em sinais: início e duração (em semicolcheias), e a letra a que pertence
  const on0 = new Float64Array(MAXS), len = new Uint8Array(MAXS), sym = new Uint8Array(MAXS);
  const labels: string[] = new Array(MAXS).fill("");
  let ns = 0, cursor = 0, msgEnd = -1, msgIdx = 0, wFor = 0, hFor = 0, lamp = 0;
  let telegram = "", sent = "", telShow = "", sentShow = "", gSky: CanvasGradient | null = null, gSea: CanvasGradient | null = null, gGlow: CanvasGradient | null = null;
  let fTape = "", fLab = "", fTel = "", fHead = "";

  const queue = (text: string, from: number) => {
    ns = 0;
    let u = from;
    for (const ch of Array.from(text)) {
      if (ns >= MAXS - 8) break;
      if (/\s/.test(ch)) { u += 4; continue; }
      const c = codeOf(ch);
      labels[ns] = ch.toLocaleUpperCase("pt-PT");
      for (let i = 0; i < c.length && ns < MAXS; i++) {
        const d = c[i] === "-" ? 3 : 1;
        on0[ns] = u; len[ns] = d; sym[ns] = d === 3 ? 1 : 0;
        if (i > 0) labels[ns] = "";
        ns++;
        u += d + 1;
      }
      u += 2;
    }
    msgEnd = u + 8;
    sent = text;
  };

  const nextMessage = (env: { title: string; artist: string }, from: number) => {
    const opts = [titleOf(env as never), artistOf(env as never)];
    const msg = lyr.real ? lyr.text : opts[msgIdx % 2];
    msgIdx++;
    queue(msg, from);
    telegram = telegram ? `${telegram} STOP ${msg}` : msg;
    if (telegram.length > 140) telegram = telegram.slice(telegram.length - 140);
    telShow = telegram.length > 46 ? `…${telegram.slice(telegram.length - 45)}` : telegram;
    sentShow = sent.length > 40 ? `${sent.slice(0, 39)}…` : sent;
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h);
      if (w !== wFor || h !== hFor) {
        wFor = w; hFor = h;
        gSky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
        gSky.addColorStop(0, "#03040a"); gSky.addColorStop(1, "#0d1424");
        gSea = ctx.createLinearGradient(0, h * 0.55, 0, h);
        gSea.addColorStop(0, "#08111d"); gSea.addColorStop(1, "#010205");
        gGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gGlow.addColorStop(0, "rgba(255,250,235,1)"); gGlow.addColorStop(0.15, "rgba(255,240,200,.5)"); gGlow.addColorStop(1, "rgba(255,230,180,0)");
        fTape = `700 ${Math.round(k * 0.03)}px ${MONO}`;
        fLab = `700 ${Math.round(k * 0.028)}px ${MONO}`;
        fTel = `${Math.round(k * 0.034)}px ${TYPE}`;
        fHead = `700 ${Math.round(k * 0.026)}px ${MONO}`;
      }
      const now = s.beatPos * 4;
      const changed = lyr.update(env, t, s);
      if (sec.hit(s) || msgEnd < 0 || (changed && lyr.real) || now > msgEnd) { cursor = 0; nextMessage(env, Math.ceil(now) + 1); }
      while (cursor < ns && on0[cursor] + len[cursor] <= now) cursor++;
      let isOn = cursor < ns && now >= on0[cursor] && now < on0[cursor] + len[cursor];
      const sos = s.drop > 0.4 || s.section === "drop";
      if (sos) isOn = Math.floor(now) % 2 === 0;
      if (env.reduceMotion) isOn = true;
      lamp = isOn ? Math.min(1, lamp + dt * 40) : Math.max(0, lamp - dt * 18);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = gSky!;
      ctx.fillRect(0, 0, w, h * 0.55);
      ctx.fillStyle = gSea!;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);
      // o mar a cintilar com a luz
      const lx = w * 0.27, ly = h * 0.42;
      ctx.fillStyle = "#cfe0ff";
      for (let i = 0; i < 90; i++) {
        const sx = ((i * 97.3) % 1) * w, yy = h * 0.56 + ((i * 0.618) % 1) ** 2 * h * 0.3;
        const tw = Math.sin(t * 3 + i) * 0.5 + 0.5;
        ctx.globalAlpha = (0.05 + 0.25 * s.beat + 0.5 * lamp * Math.exp(-Math.abs(sx - lx) / (w * 0.25))) * tw;
        ctx.fillRect(sx, yy, k * 0.02 * (1 + yy / h), 1.5);
      }
      ctx.globalAlpha = 1;
      // o promontório e a lâmpada
      ctx.fillStyle = "#020306";
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5); ctx.lineTo(w * 0.18, h * 0.46); ctx.lineTo(w * 0.36, h * 0.53); ctx.lineTo(w * 0.42, h * 0.58); ctx.lineTo(0, h * 0.6);
      ctx.fill();
      ctx.fillStyle = "#15171c";
      ctx.fillRect(lx - k * 0.05, ly - k * 0.06, k * 0.1, k * 0.12);
      ctx.fillStyle = "#0a0b0e";
      ctx.fillRect(lx - k * 0.012, ly + k * 0.06, k * 0.024, h * 0.5 - ly);
      // feixe e brilho
      ctx.globalCompositeOperation = "lighter";
      if (lamp > 0.01) {
        const spread = 0.08 + 0.1 * s.bass;
        ctx.fillStyle = sos ? env.colors[1] : "rgba(255,240,210,1)";
        ctx.globalAlpha = 0.18 * lamp;
        ctx.beginPath();
        ctx.moveTo(lx + k * 0.04, ly);
        ctx.lineTo(w * 1.05, ly - h * (spread + 0.05));
        ctx.lineTo(w * 1.05, ly + h * (spread + 0.08));
        ctx.fill();
        ctx.globalAlpha = lamp;
        ctx.setTransform(k * (0.18 + 0.6 * lamp + 0.2 * s.bass), 0, 0, k * (0.18 + 0.6 * lamp + 0.2 * s.bass), lx, ly);
        ctx.fillStyle = gGlow!;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.07 * lamp;
        ctx.fillStyle = sos ? env.colors[1] : "#fff4dc";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      // a lente com as palhetas
      ctx.fillStyle = lamp > 0.5 ? "#fffaf0" : "#2a2c33";
      ctx.beginPath(); ctx.arc(lx, ly, k * 0.04, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#0b0c10";
      const open = lamp;
      for (let i = -2; i <= 2; i++) ctx.fillRect(lx - k * 0.042, ly + i * k * 0.016 - k * 0.003 * (1 - open) * 2, k * 0.084, k * 0.004 + k * 0.01 * (1 - open));

      // o telegrama em cima
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = fHead;
      ctx.fillStyle = "rgba(255,220,150,.7)";
      ctx.fillText(sos ? "··· ——— ···  SOS" : "TELEGRAMA · OMS MUSIC", w * 0.5, h * 0.08);
      ctx.font = fTel;
      ctx.fillStyle = "#f3ead6";
      ctx.fillText(telShow, w * 0.5, h * 0.13, w * 0.46);
      ctx.fillStyle = env.colors[0];
      ctx.fillText(sentShow, w * 0.5, h * 0.2, w * 0.46);

      // a fita de papel em baixo
      const ty = h * 0.8, th = k * 0.11, up = k * 0.022;
      ctx.fillStyle = "#e9e1cc";
      ctx.fillRect(0, ty, w, th);
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.fillRect(0, ty + th, w, 3);
      const head = w * 0.72;
      ctx.fillStyle = "#c8102e";
      ctx.fillRect(head - 1, ty - k * 0.01, 2, th + k * 0.02);
      ctx.font = fLab;
      ctx.textAlign = "center";
      for (let i = 0; i < ns; i++) {
        const x = head - (now - on0[i]) * up;
        const ww = len[i] * up;
        if (x > w || x + ww < 0 || on0[i] > now) continue;
        const done = Math.min(ww, (now - on0[i]) * up);
        ctx.fillStyle = "#161419";
        if (sym[i]) ctx.fillRect(x, ty + th * 0.28, done, th * 0.16);
        else { ctx.beginPath(); ctx.arc(x + up * 0.5, ty + th * 0.36, th * 0.08, 0, 6.283); ctx.fill(); }
        if (labels[i]) { ctx.fillStyle = "#5a4d3a"; ctx.fillText(labels[i], x + up, ty + th * 0.56); }
      }
      ctx.font = fTape;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    },
  };
});
