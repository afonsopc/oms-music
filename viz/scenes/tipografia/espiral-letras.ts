/**
 * Espiral de letras: as palavras cantadas enroladas numa espiral em 3D à
 * volta de quem vê, a vir na nossa direcção e a passar por nós, cada uma
 * deitada ao longo da curva. Os graves rodam a espiral, a batida faz pulsar
 * o raio, na queda a viagem acelera e a espiral abre-se; cada secção roda
 * para o outro lado. Sem letra: o título e o artista em espiral.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { damp } from "../../lib/ease";
import { Lyric, WIDE, hash1 } from "./_lib";

const N = 90;
const F = 100;
const FONT = `${F}px ${WIDE}`;

export default canvasScene({
  id: "espiral-letras",
  name: "Espiral de letras",
  names: { en: "Lyric spiral", lv: "Vārdu spirāle" },
  families: ["electronic", "chaos"],
  tags: ["3d", "texto", "letra", "túnel", "viagem"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const text: string[] = new Array(N).fill("");
  const wz = new Float32Array(N), wa = new Float32Array(N), ww = new Float32Array(N), born = new Float32Array(N);
  const col = new Uint8Array(N), alive = new Uint8Array(N);
  let head = 0, cam = 0, ang = 0, spin = 1, spinV = 0.3, lastA = 0, spawned = 0, speed = 1, open = 0, measured = false;

  const add = (ctx: CanvasRenderingContext2D, word: string, t: number, hot: boolean) => {
    const i = head; head = (head + 1) % N;
    text[i] = word;
    ctx.font = FONT;
    ww[i] = ctx.measureText(word).width;
    lastA += 0.32 + Math.min(0.9, ww[i] / 900);
    wa[i] = lastA;
    wz[i] = cam + 7;
    born[i] = t; alive[i] = 1;
    col[i] = hot ? 3 : Math.floor(hash1(i + t) * 3);
  };

  return {
    reset() { measured = false; },
    frame(ctx, w, h, dt, t, s, env) {
      if (!measured) {
        measured = true;
        // começar já com a espiral cheia (as palavras da frase actual pelo caminho)
        alive.fill(0);
        lyr.update(env, t, s);
        for (let j = 0; j < 24; j++) { add(ctx, lyr.words[j % Math.max(1, lyr.n)] || "OMS", t - 9, false); wz[(head - 1 + N) % N] = cam + 0.6 + j * 0.28; }
        spawned = lyr.n;
      }
      if (lyr.update(env, t, s)) spawned = 0;
      const shown = lyr.shown(t, env);
      while (spawned < shown) { add(ctx, lyr.words[spawned], t, spawned === shown - 1); spawned++; }
      if (sec.hit(s)) { spin = -spin; if (sec.big) open = 1; }
      open = Math.max(0, open - dt * 0.6);
      speed = damp(speed, 0.6 + 1.2 * s.energy + 4 * s.drop, 3, dt);
      if (!env.reduceMotion) cam += dt * speed * 0.45;
      spinV = damp(spinV, spin * (0.15 + 0.9 * s.bass), 2, dt);
      if (!env.reduceMotion) ang += spinV * dt;

      const k = Math.min(w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(3,2,8,0.55)";
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const fl = k * 0.9;
      const R = 1 + 0.12 * s.beat + 0.8 * open;
      // a linha da espiral, ténue
      ctx.strokeStyle = env.colors[2];
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = Math.max(1, k * 0.002);
      ctx.beginPath();
      const a0 = lastA - 22;
      for (let j = 0; j <= 160; j++) {
        const a = a0 + j * 0.16;
        const z = cam + 7 - (lastA - a) * (7 / 22) * 0.98;
        const d = z - cam;
        if (d < 0.15) continue;
        const px = cx + (Math.cos(a + ang) * R * fl) / d, py = cy + (Math.sin(a + ang) * R * fl) / d;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // de longe para perto
      for (let n = 1; n <= N; n++) {
        const i = (head - n + N) % N;
        if (!alive[i]) continue;
        const d = wz[i] - cam;
        if (d < 0.12) { alive[i] = 0; continue; }
        const a = wa[i] + ang;
        const sc = (R * fl) / d / F * 0.22;
        const px = cx + (Math.cos(a) * R * fl) / d, py = cy + (Math.sin(a) * R * fl) / d;
        const rot = a + Math.PI / 2;
        const c = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
        ctx.setTransform(c, sn, -sn, c, px, py);
        const fade = Math.min(1, (7 - d) / 1.5) * Math.min(1, d / 0.5);
        const fresh = Math.max(0, 1 - (t - born[i]) * 1.5);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = col[i] === 3 || fresh > 0.3 ? "#fff" : env.colors[col[i]];
        ctx.fillText(text[i], 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (s.drop > 0.05) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = env.colors[1];
        ctx.globalAlpha = s.drop * 0.35;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    },
  };
});
