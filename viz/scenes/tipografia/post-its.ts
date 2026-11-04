/**
 * Parede de post-its: cada palavra cantada é escrita a marcador num papel
 * autocolante e colada na parede com uma palmada, umas por cima das outras.
 * Os graves fazem esvoaçar as pontas, a batida dá um saltinho às mais
 * novas, e na queda uma rajada leva tudo e a parede fica limpa para a
 * secção nova. Sem letra: o título e o artista, palavra a palavra.
 */
import { canvasScene } from "../../lib/canvas";
import { SectionEdge } from "../../lib/beat";
import { clamp, easeOutBack } from "../../lib/ease";
import { Lyric, SANS, WIDE, artistOf, fit, hash1, titleOf } from "./_lib";

const N = 40;
const COLORS = ["#ffe66b", "#ff9fc4", "#8fe3ff", "#b6f28a", "#ffb35c"];

export default canvasScene({
  id: "post-its",
  name: "Parede de post-its",
  names: { en: "Sticky-note wall", lv: "Līmlapiņu siena" },
  families: ["electronic", "chaos"],
  tags: ["papel", "texto", "letra", "escritório", "brincalhão"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, () => {
  const lyr = new Lyric();
  const sec = new SectionEdge();
  const cvs: HTMLCanvasElement[] = [];
  for (let i = 0; i < N; i++) cvs.push(document.createElement("canvas"));
  const x = new Float32Array(N), y = new Float32Array(N), r = new Float32Array(N), born = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), vr = new Float32Array(N);
  const alive = new Uint8Array(N), flying = new Uint8Array(N);
  const order = new Int16Array(N);
  const wall = document.createElement("canvas");
  let next = 0, slot = 0, spawned = 0, size = 100, wFor = 0, hFor = 0, palShift = 0, zc = 0;

  const paintWall = (w: number, h: number, env: { colors: [string, string, string] }) => {
    wall.width = w; wall.height = h;
    const x2 = wall.getContext("2d")!;
    x2.fillStyle = "#e9e5dc";
    x2.fillRect(0, 0, w, h);
    const g = x2.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.8);
    g.addColorStop(0, env.colors[0] + "33"); g.addColorStop(1, "#00000055");
    x2.fillStyle = g;
    x2.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { x2.fillStyle = hash1(i) > 0.5 ? "rgba(0,0,0,.03)" : "rgba(255,255,255,.06)"; x2.fillRect(hash1(i * 2.3) * w, hash1(i * 3.7) * h, 2, 2); }
  };

  const make = (i: number, word: string, seed: number) => {
    const c = cvs[i];
    const s = Math.round(size);
    c.width = c.height = s;
    const x2 = c.getContext("2d")!;
    const col = COLORS[(Math.floor(hash1(seed) * COLORS.length) + palShift) % COLORS.length];
    x2.fillStyle = col;
    x2.fillRect(0, 0, s, s);
    const g = x2.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "rgba(0,0,0,.08)"); g.addColorStop(0.12, "rgba(0,0,0,0)"); g.addColorStop(0.85, "rgba(255,255,255,.12)"); g.addColorStop(1, "rgba(0,0,0,.12)");
    x2.fillStyle = g;
    x2.fillRect(0, 0, s, s);
    // a palavra a marcador
    const face = hash1(seed + 1) > 0.5 ? (px: number) => `900 ${px}px ${SANS}` : (px: number) => `${px}px ${WIDE}`;
    const fs = fit(x2, word, s * 0.8, face, s * 0.42, 8);
    x2.font = face(fs);
    x2.fillStyle = hash1(seed + 2) > 0.8 ? "#c8102e" : "#1b1b22";
    x2.textAlign = "center";
    x2.textBaseline = "middle";
    x2.save();
    x2.translate(s / 2, s * 0.52);
    x2.rotate((hash1(seed + 3) - 0.5) * 0.12);
    x2.fillText(word, 0, 0);
    if (hash1(seed + 4) > 0.75) { x2.fillRect(-x2.measureText(word).width / 2, fs * 0.45, x2.measureText(word).width, Math.max(2, fs * 0.06)); }
    x2.restore();
  };

  const add = (word: string, w: number, h: number, t: number) => {
    const i = next; next = (next + 1) % N;
    // grelha solta, da esquerda para a direita e de cima para baixo
    const cols = Math.max(3, Math.floor((w * 0.9) / (size * 1.05)));
    const rows = Math.max(2, Math.floor((h * 0.86) / (size * 1.05)));
    const sl = slot % (cols * rows);
    slot++;
    const cx = sl % cols, cy = Math.floor(sl / cols);
    const gx = (w - cols * size * 1.05) / 2, gy = (h - rows * size * 1.05) / 2;
    make(i, word, slot * 13 + lyr.serial);
    x[i] = gx + (cx + 0.5) * size * 1.05 + (hash1(slot) - 0.5) * size * 0.25;
    y[i] = gy + (cy + 0.5) * size * 1.05 + (hash1(slot + 1) - 0.5) * size * 0.25;
    r[i] = (hash1(slot + 2) - 0.5) * 0.3;
    born[i] = t; alive[i] = 1; flying[i] = 0;
    order[i] = ++zc;
  };

  return {
    reset() { wFor = 0; },
    frame(ctx, w, h, dt, t, s, env) {
      const k = Math.min(w, h);
      if (w !== wFor || h !== hFor) {
        wFor = w; hFor = h; size = k * 0.19; paintWall(w, h, env); alive.fill(0); slot = 0; spawned = 0;
        // a parede já com o título e o artista colados
        for (const wd of `${titleOf(env)} ${artistOf(env)}`.split(/\s+/).filter(Boolean).slice(0, 8)) add(wd, w, h, t - 9);
      }
      if (lyr.update(env, t, s)) spawned = 0;
      const shown = lyr.shown(t, env);
      while (spawned < shown) { add(lyr.words[spawned], w, h, lyr.starts[spawned]); spawned++; }
      if (sec.hit(s) && sec.big) {
        // a rajada
        for (let i = 0; i < N; i++) if (alive[i]) { flying[i] = 1; vx[i] = k * (1.5 + hash1(i + t) * 2.5); vy[i] = -k * (0.4 + hash1(i * 3 + t)); vr[i] = (hash1(i * 7) - 0.3) * 8; }
        slot = 0; palShift++;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(wall, 0, 0);
      for (let i = 0; i < N; i++) {
        if (!alive[i] || !flying[i]) continue;
        vy[i] += k * 1.2 * dt; x[i] += vx[i] * dt; y[i] += vy[i] * dt; r[i] += vr[i] * dt;
        if (x[i] > w + size * 2 || y[i] > h + size * 2) alive[i] = 0;
      }
      // pela ordem em que foram coladas (poucas: uma procura por nível)
      let minZ = 1e9;
      for (let i = 0; i < N; i++) if (alive[i] && order[i] < minZ) minZ = order[i];
      for (let z = minZ; z <= zc; z++) {
        let i = -1;
        for (let j = 0; j < N; j++) if (alive[j] && order[j] === z) { i = j; break; }
        if (i < 0) continue;
        const a = env.reduceMotion ? 1 : clamp((t - born[i]) / 0.25);
        const e = easeOutBack(a);
        const sc = (1 + (1 - e) * 0.5) * (1 + (t - born[i] < 2 ? 0.04 * s.beat : 0));
        const flut = flying[i] ? 0.3 * Math.sin(t * 20 + i) : (0.04 + 0.1 * s.bass) * Math.sin(t * 7 + i * 1.7);
        const c = Math.cos(r[i]) * sc, sn = Math.sin(r[i]) * sc;
        ctx.globalAlpha = Math.min(1, a * 3);
        ctx.setTransform(c, sn, -sn + flut * c, c + flut * sn, x[i], y[i]);
        ctx.fillStyle = "rgba(0,0,0,.22)";
        ctx.fillRect(-size / 2 + k * 0.006, -size / 2 + k * 0.012, size, size * (1 + Math.abs(flut) * 0.5));
        ctx.drawImage(cvs[i], -size / 2, -size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
});
