/**
 * Fogo-de-artifício: um foguete sobe em cada compasso e rebenta na batida
 * seguinte nas cores da capa; nas quedas e nos refrões rebentam vários de
 * uma vez. Os graves dão o tamanho, os agudos o brilho das faúlhas.
 * É também a cena de exemplo do viz/scenes/README.md.
 */
import { canvasScene } from "../../lib/canvas";
import { BarEdge, BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { Particles } from "../../lib/particles";
import { css } from "../../lib/palette";

export default canvasScene({
  id: "fogo",
  name: "Fogo-de-artifício",
  names: { en: "Fireworks", lv: "Salūts" },
  families: ["calm", "electronic"],
  tags: ["festa", "noite", "partículas"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "high", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, () => {
  // tudo alocado aqui, uma vez; o frame só mexe em números
  const sparks = new Particles(3000);
  const rockets = new Particles(16);
  const bar = new BarEdge(1);
  const beat = new BeatEdge(1);
  const section = new SectionEdge();
  const flash = new Envelope(0.01, 0.4);
  let armed = -1;

  const burst = (x: number, y: number, n: number, speed: number, color: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const v = speed * (0.4 + 0.6 * Math.random());
      sparks.emit(x, y, Math.cos(a) * v, Math.sin(a) * v, 1.2 + Math.random() * 0.8, color);
    }
  };

  return {
    reset() { sparks.clear(); rockets.clear(); },
    frame(ctx, w, h, dt, _t, s, env) {
      const k = Math.min(w, h);
      // um foguete por compasso; rebenta na batida seguinte
      if (bar.hit(s)) armed = rockets.emit(w * (0.2 + 0.6 * Math.random()), h, (Math.random() - 0.5) * k * 0.1, -k * 0.9, 3, Math.floor(Math.random() * 3));
      const exploded = beat.hit(s) && armed >= 0 && rockets.life[armed] > 0;
      if (exploded) {
        const i = armed;
        burst(rockets.x[i], rockets.y[i], 90 + Math.round(160 * s.bass), k * (0.35 + 0.35 * s.bass), rockets.data[i]);
        rockets.life[i] = 0;
        armed = -1;
        flash.kick(0.25);
      }
      // queda ou refrão: vários de uma vez e um clarão
      if (section.hit(s) && section.big) {
        for (let j = 0; j < 5; j++) burst(w * (0.15 + 0.7 * Math.random()), h * (0.15 + 0.4 * Math.random()), 160, k * 0.6, j % 3);
        flash.kick(1);
      }
      rockets.step(dt, 0, k * 0.5);
      sparks.step(dt, 0, k * 0.25, 1.4);
      flash.step(0, dt);

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(0,0,8,${0.18 + 0.2 * (1 - s.high)})`;
      ctx.fillRect(0, 0, w, h);
      if (flash.v > 0.01) {
        ctx.fillStyle = css(env.colorVecs[1], flash.v * 0.35);
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "lighter";
      const r = Math.max(1, k / 360) * (1 + s.high);
      for (let i = 0; i < rockets.capacity; i++) {
        if (rockets.life[i] <= 0) continue;
        ctx.fillStyle = "#fff";
        ctx.fillRect(rockets.x[i] - r, rockets.y[i] - r * 3, r * 2, r * 6);
      }
      for (let c = 0; c < 3; c++) {
        // uma cor de cada vez: menos mudanças de fillStyle
        ctx.fillStyle = env.colors[c];
        for (let i = 0; i < sparks.capacity; i++) {
          if (sparks.life[i] <= 0 || sparks.data[i] !== c) continue;
          const life = sparks.life[i] / sparks.max[i];
          const sz = r * (0.6 + 1.6 * life);
          ctx.globalAlpha = Math.min(1, life * 1.5);
          ctx.fillRect(sparks.x[i] - sz / 2, sparks.y[i] - sz / 2, sz, sz);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
});
