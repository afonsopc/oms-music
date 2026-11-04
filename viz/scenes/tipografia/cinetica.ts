/**
 * Tipografia cinética: a letra palavra a palavra, empilhada como num cartaz
 * (cada palavra esticada à largura da coluna), a palavra nova a cair de
 * cima com peso. Batida: o bloco salta e treme; graves: o fundo respira;
 * queda: cores trocadas e um clarão; cada secção troca a disposição
 * (pilha, uma palavra gigante, diagonal). Sem letra: título e artista.
 */
import { canvasScene } from "../../lib/canvas";
import { Envelope, SectionEdge } from "../../lib/beat";
import { clamp, easeOutBack, easeOutExpo } from "../../lib/ease";
import { Lyric, WIDE, hash1, upper } from "./_lib";

const F = 100;
const FONT = `${F}px ${WIDE}`;

export default canvasScene({
  id: "cinetica",
  name: "Tipografia cinética",
  names: { en: "Kinetic type", lv: "Kinētiskā tipogrāfija" },
  families: ["chaos", "electronic"],
  tags: ["texto", "letra", "cartaz", "tipografia"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "beat", "onset", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const flash = new Envelope(0.005, 0.5);
  const shake = new Envelope(0.005, 0.18);
  const widths = new Float32Array(64);
  const caps: string[] = [];
  let measured = -1, mode = 0, inverted = false;

  return {
    reset() { measured = -1; },
    frame(ctx, w, h, dt, t, s, env) {
      if (lyr.update(env, t, s) || measured !== lyr.serial) {
        measured = lyr.serial;
        ctx.font = FONT;
        caps.length = 0;
        for (let i = 0; i < lyr.n; i++) {
          caps.push(upper(lyr.words[i]));
          widths[i] = Math.max(1, ctx.measureText(caps[i]).width);
        }
      }
      if (sec.hit(s)) { mode = (mode + 1) % 3; if (sec.big) { flash.kick(1); inverted = !inverted; } }
      if (s.drop > 0.9) flash.kick(1);
      if (s.beat > 0.9) shake.kick(0.4 + s.bass);
      flash.step(0, dt); shake.step(0, dt);

      const [c0, c1, c2] = env.colors;
      const bg = inverted ? c1 : "#07060a";
      const fg = inverted ? "#07060a" : "#f4f1ea";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // faixas de cor por trás, a respirar com os graves
      const k = Math.min(w, h);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = inverted ? c2 : c0;
      const band = h * (0.18 + 0.22 * s.bass);
      ctx.fillRect(0, h * 0.5 - band / 2 + Math.sin(t * 0.7) * h * 0.2, w, band);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = inverted ? c0 : c2;
      ctx.fillRect(w * (0.08 + 0.05 * Math.sin(t * 0.4)), 0, k * (0.04 + 0.05 * s.beat), h);
      ctx.globalAlpha = 1;

      const n = lyr.shown(t, env);
      const sx = (hash1(Math.floor(t * 30)) - 0.5) * k * 0.03 * shake.v;
      const sy = (hash1(Math.floor(t * 30) + 7) - 0.5) * k * 0.03 * shake.v;
      ctx.font = FONT;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      const pump = 1 + 0.05 * s.beat;

      if (mode === 1 && n > 0) {
        // uma palavra gigante, a anterior em contorno por trás
        const i = n - 1, a = lyr.age(i, t);
        const sz = Math.min((w * 0.9) / widths[i], (h * 0.62) / (F * 0.75)) * pump;
        const e = env.reduceMotion ? 1 : easeOutExpo(clamp(a / 0.35));
        if (i > 0) {
          const j = i - 1, sj = Math.min((w * 1.3) / widths[j], (h * 0.9) / (F * 0.75));
          ctx.setTransform(sj, 0, 0, sj, w / 2 - (widths[j] * sj) / 2, h * 0.5 + F * 0.36 * sj);
          ctx.strokeStyle = c2; ctx.lineWidth = 1.2 / sj * k / 300; ctx.globalAlpha = 0.5;
          ctx.strokeText(caps[j], 0, 0);
          ctx.globalAlpha = 1;
        }
        const sc = sz * (1 + 1.6 * (1 - e));
        ctx.setTransform(sc, 0, 0, sc, w / 2 - (widths[i] * sc) / 2 + sx, h * 0.5 + F * 0.36 * sc + sy);
        ctx.fillStyle = fg;
        ctx.globalAlpha = e;
        ctx.fillText(caps[i], 0, 0);
        ctx.globalAlpha = 1;
      } else if (n > 0) {
        // pilha justificada (mode 0) ou em escada na diagonal (mode 2)
        const from = Math.max(0, n - 6);
        const colW = w * (mode === 2 ? 0.62 : 0.78);
        let total = 0;
        for (let i = from; i < n; i++) total += (colW / widths[i]) * F * 0.8;
        const fitK = Math.min(1, (h * 0.86) / Math.max(1, total));
        let y = h / 2 - (total * fitK) / 2;
        for (let i = from; i < n; i++) {
          const sz = (colW / widths[i]) * fitK;
          const lh = sz * F * 0.8;
          const a = lyr.age(i, t);
          const e = env.reduceMotion ? 1 : clamp(a / 0.3);
          const drop = (1 - easeOutBack(e)) * -h * 0.25;
          const step = mode === 2 ? ((i - from) / Math.max(1, n - from - 1) - 0.5) * w * 0.3 : 0;
          const tilt = mode === 2 ? -0.08 : 0;
          const x0 = w / 2 - (colW * fitK) / 2 + step + sx;
          const isNew = i === n - 1;
          const ss = sz * (isNew ? pump : 1);
          ctx.setTransform(ss, tilt * ss, 0, ss, x0, y + lh * 0.9 + drop + sy);
          ctx.globalAlpha = Math.min(1, e * 2);
          ctx.fillStyle = isNew ? fg : (i % 3 === 0 ? c1 : i % 3 === 1 ? fg : c2);
          if (!isNew && (i & 1)) { ctx.strokeStyle = fg; ctx.lineWidth = 2.5 / ss; ctx.strokeText(caps[i], 0, 0); }
          else ctx.fillText(caps[i], 0, 0);
          y += lh;
        }
        ctx.globalAlpha = 1;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (flash.v > 0.02) {
        ctx.globalAlpha = flash.v * 0.7;
        ctx.fillStyle = c1;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
    },
  };
});
