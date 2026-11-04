/**
 * Eléctrico 28: um desenho de linhas de néon. O eléctrico amarelo sobe e
 * desce as colinas de Lisboa com as fachadas de azulejo a passar, o fio
 * por cima, o castelo lá atrás. As janelas das casas acendem-se na batida,
 * o trólei deita faíscas nos ataques, e na queda desce a rua a abrir.
 */
import { canvasScene } from "../../lib/canvas";
import { BeatEdge } from "../../lib/beat";
import { Particles } from "../../lib/particles";
import { damp } from "../../lib/ease";

const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export default canvasScene({
  id: "electrico",
  name: "Eléctrico 28",
  names: { en: "Tram 28" },
  families: ["electronic", "calm"],
  tags: ["lisboa", "eléctrico", "linhas", "néon", "cidade"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "onset", "drop", "section", "palette"],
  lyrics: "ink",
}, () => {
  const sparks = new Particles(400);
  const beat = new BeatEdge(1);
  let dist = 3.7, speed = 0.15, onsetArmed = true;
  // a rua: altura (em fracções de h) num ponto do mundo (em unidades de h)
  const street = (x: number) => 0.74 - 0.1 * Math.sin(x * 0.9) - 0.05 * Math.sin(x * 2.3 + 1);
  const YELLOW = "#ffc83a";

  return {
    reset() { sparks.clear(); },
    frame(ctx, w, h, dt, t, s, env) {
      const k = h;
      const calm = s.section === "intro" || s.section === "breakdown" || s.section === "outro";
      speed = damp(speed, 0.1 + 0.22 * s.bass + 0.15 * s.energy + 0.6 * s.drop - (calm ? 0.05 : 0), 2, dt);
      if (!env.reduceMotion) dist += dt * speed;
      const left = dist - (w / k) * 0.45;
      const toX = (wx: number) => (wx - left) * k;

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#05040a";
      ctx.fillRect(0, 0, w, h);
      // o céu a clarear para baixo, em faixas suaves (sem gradientes novos)
      ctx.fillStyle = env.colors[0];
      for (let i = 0; i < 8; i++) {
        ctx.globalAlpha = (0.012 + 0.008 * s.energy) * (1 + i * 0.25);
        ctx.fillRect(0, h * (0.2 + i * 0.1), w, h * (0.8 - i * 0.1));
      }
      ctx.globalAlpha = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalCompositeOperation = "lighter";

      // lá atrás: a colina do castelo (anda devagar)
      const par = left * 0.15;
      ctx.strokeStyle = env.colors[2];
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, k / 400);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 10) {
        const wx = x / k + par;
        const y = h * (0.42 - 0.12 * Math.exp(-((((((wx % 4) + 4) % 4) - 2) ** 2) * 1.5)) - 0.02 * Math.sin(wx * 3));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // as ameias, em cima da colina
      for (let c = Math.floor(par / 4) - 1; c <= Math.floor((par + w / k) / 4) + 1; c++) {
        const cx = (c * 4 + 2 - par) * k, base = h * 0.3;
        ctx.beginPath();
        ctx.moveTo(cx - k * 0.12, base);
        for (let m = 0; m < 6; m++) {
          const x0 = cx - k * 0.12 + m * k * 0.04;
          ctx.lineTo(x0, base - k * 0.03);
          ctx.lineTo(x0 + k * 0.02, base - k * 0.03);
          ctx.lineTo(x0 + k * 0.02, base - k * 0.02);
          ctx.lineTo(x0 + k * 0.04, base - k * 0.02);
        }
        ctx.lineTo(cx + k * 0.12, base);
        ctx.stroke();
      }

      // as casas ao longo da rua
      const HW = 0.26;
      const first = Math.floor(left / HW) - 1, last = Math.floor((left + w / k) / HW) + 1;
      const beatN = Math.floor(s.beatPos);
      for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? Math.max(4, k / 90) : Math.max(1.2, k / 420);
        ctx.globalAlpha = pass === 0 ? 0.08 : 0.85;
        for (let i = first; i <= last; i++) {
          const x0 = toX(i * HW + 0.01), x1 = toX((i + 1) * HW - 0.01);
          const yb = h * Math.max(street(i * HW), street((i + 1) * HW)) - k * 0.02;
          const hh = k * (0.28 + 0.2 * hash(i, 1));
          ctx.strokeStyle = env.colors[((i % 3) + 3) % 3];
          ctx.beginPath();
          ctx.rect(x0, yb - hh, x1 - x0, hh);
          // telhado
          ctx.moveTo(x0 - k * 0.01, yb - hh);
          ctx.lineTo((x0 + x1) / 2, yb - hh - k * 0.04 * hash(i, 2));
          ctx.lineTo(x1 + k * 0.01, yb - hh);
          ctx.stroke();
          // janelas e varandas
          const rows = 2 + Math.floor(hash(i, 3) * 2), cols = 3;
          const ww = (x1 - x0) / (cols * 2 + 1), wh = hh / (rows * 2 + 1.5);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const wx = x0 + ww * (1 + c * 2), wy = yb - hh + wh * (1 + r * 2);
              const lit = hash(i * 7 + r * 3 + c, beatN * 0.37 + 0.5) < 0.25 + 0.5 * s.energy;
              if (pass === 1 && lit) {
                ctx.fillStyle = r === 0 && c === 1 ? env.colors[1] : YELLOW;
                ctx.globalAlpha = 0.25 + 0.35 * s.beat;
                ctx.fillRect(wx, wy, ww, wh);
                ctx.globalAlpha = 0.85;
              }
              ctx.strokeRect(wx, wy, ww, wh);
            }
            ctx.beginPath();
            ctx.moveTo(x0 + ww * 0.6, yb - hh + wh * (2 + r * 2) + 2);
            ctx.lineTo(x1 - ww * 0.6, yb - hh + wh * (2 + r * 2) + 2);
            ctx.stroke();
          }
          // a porta
          ctx.strokeRect(x0 + (x1 - x0) * 0.4, yb - wh * 1.3, (x1 - x0) * 0.2, wh * 1.3);
        }
      }

      // a rua, os carris, o fio e os postes
      for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? Math.max(5, k / 80) : Math.max(1.5, k / 350);
        ctx.globalAlpha = pass === 0 ? 0.1 : 0.9;
        ctx.strokeStyle = "#d8d4e8";
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * street(left + x / k);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = env.colors[1];
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const wx = left + x / k;
          const pole = ((wx % 0.8) + 0.8) % 0.8;
          const sag = 0.03 * Math.sin((pole / 0.8) * Math.PI);
          const y = h * (street(wx) - 0.36 + sag);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        for (let p = Math.floor(left / 0.8); p <= Math.floor((left + w / k) / 0.8) + 1; p++) {
          const x = toX(p * 0.8);
          ctx.beginPath();
          ctx.moveTo(x, h * street(p * 0.8));
          ctx.lineTo(x, h * (street(p * 0.8) - 0.4));
          ctx.stroke();
        }
      }

      // o eléctrico
      const tx = w * 0.45, twx = left + tx / k;
      const ty = h * street(twx) - k * (0.012 * s.beat + 0.004 * Math.sin(t * 9) * s.energy);
      const slope = (street(twx + 0.01) - street(twx - 0.01)) / 0.02;
      const ang = Math.atan(slope);
      const L = k * 0.4, H = k * 0.17;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? Math.max(8, k / 55) : Math.max(2, k / 260);
        ctx.globalAlpha = pass === 0 ? 0.12 + 0.1 * s.beat : 1;
        ctx.strokeStyle = YELLOW;
        ctx.beginPath();
        ctx.roundRect(-L / 2, -H - k * 0.02, L, H, k * 0.025);
        ctx.moveTo(-L / 2, -k * 0.07);
        ctx.lineTo(L / 2, -k * 0.07);
        ctx.moveTo(-L * 0.42, -H - k * 0.02);
        ctx.lineTo(-L * 0.38, -H - k * 0.045);
        ctx.lineTo(L * 0.38, -H - k * 0.045);
        ctx.lineTo(L * 0.42, -H - k * 0.02);
        ctx.stroke();
        // janelas
        for (let i = 0; i < 6; i++) {
          const wx = -L / 2 + L * (0.06 + i * 0.155);
          ctx.strokeRect(wx, -H + k * 0.0, L * 0.11, H * 0.4);
        }
        // rodas
        ctx.beginPath();
        ctx.arc(-L * 0.28, -k * 0.012, k * 0.016, 0, Math.PI * 2);
        ctx.moveTo(L * 0.28 + k * 0.016, -k * 0.012);
        ctx.arc(L * 0.28, -k * 0.012, k * 0.016, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.3 + 0.4 * s.energy;
      ctx.fillStyle = "#ffe8b0";
      for (let i = 0; i < 6; i++) ctx.fillRect(-L / 2 + L * (0.06 + i * 0.155), -H, L * 0.11, H * 0.4);
      // o número na frente
      ctx.globalAlpha = 1;
      ctx.fillStyle = YELLOW;
      ctx.font = `${Math.round(k * 0.035)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("28", L * 0.32, -H * 0.88);
      // o farol
      ctx.globalAlpha = 0.5 + 0.5 * s.beat;
      ctx.fillStyle = "#fff6d0";
      ctx.beginPath();
      ctx.arc(L / 2 - k * 0.01, -k * 0.045, k * 0.008, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // o trólei até ao fio
      const rx = tx - Math.cos(ang) * L * 0.2 + Math.sin(ang) * (H + k * 0.045);
      const ry = ty - Math.sin(ang) * L * 0.2 - Math.cos(ang) * (H + k * 0.045);
      const cwx = twx + 0.12;
      const pole = ((cwx % 0.8) + 0.8) % 0.8;
      const cx = toX(cwx), cy = h * (street(cwx) - 0.36 + 0.03 * Math.sin((pole / 0.8) * Math.PI));
      ctx.strokeStyle = YELLOW;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1.5, k / 350);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      // faíscas no fio: na batida algumas, nos ataques e na queda muitas
      const hit = beat.hit(s);
      if (!env.reduceMotion) {
        let n = hit ? 4 + Math.round(6 * s.energy) : 0;
        if (onsetArmed && s.onset > 0.7) { n += 18; onsetArmed = false; }
        if (s.onset < 0.3) onsetArmed = true;
        if (s.drop > 0.5) n += 3;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = k * (0.1 + 0.4 * Math.random());
          sparks.emit(cx, cy, Math.cos(a) * v - speed * k, Math.sin(a) * v - k * 0.1, 0.3 + 0.5 * Math.random(), i % 3);
        }
        sparks.step(dt, 0, k * 0.8, 1.5);
      }
      const r = Math.max(1, k / 300);
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = c === 0 ? "#ffffff" : c === 1 ? "#9fd8ff" : env.colors[1];
        for (let i = 0; i < sparks.capacity; i++) {
          if (sparks.life[i] <= 0 || sparks.data[i] !== c) continue;
          ctx.globalAlpha = Math.min(1, sparks.life[i] / sparks.max[i] * 1.5);
          ctx.fillRect(sparks.x[i] - r, sparks.y[i] - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
