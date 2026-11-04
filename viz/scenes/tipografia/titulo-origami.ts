/**
 * Origami: o título impresso numa folha dobrada em leque (dez tiras em
 * CSS 3D), que se abre na batida e se volta a fechar, com a luz a correr
 * pelas dobras. Os graves abrem-na mais, nas calmas fica quase fechada, na
 * queda abre-se de uma vez e dá uma volta inteira. Por baixo do título, a
 * linha da letra que está a tocar (ou o artista).
 */
import { domScene } from "../../lib/dom";
import { damp } from "../../lib/ease";
import { Lyric, SANS, WIDE, artistOf, titleOf } from "./_lib";

const N = 10;

export default domScene({
  id: "titulo-origami",
  name: "Origami",
  names: { en: "Origami", lv: "Origami" },
  families: ["electronic", "retro"],
  tags: ["papel", "3d", "título", "texto", "dobras"],
  intensity: 2,
  cost: 2,
  signals: ["bass", "beat", "drop", "section", "title", "lyric", "palette"],
  lyrics: "own",
}, () => {
  let root: HTMLDivElement | null = null;
  let paper: HTMLDivElement | null = null;
  const strips: HTMLDivElement[] = [];
  const shades: HTMLDivElement[] = [];
  const lines: HTMLDivElement[] = [];
  const titles: HTMLDivElement[] = [];
  const lyr = new Lyric();
  let open = 0.5, spin = 0, spinV = 0, lastSerial = -1;

  return {
    mount(host, env) {
      const [c0, c1, c2] = env.colors;
      root = document.createElement("div");
      root.style.cssText = `position:absolute;inset:0;overflow:hidden;background:radial-gradient(ellipse at 50% 40%, ${c0}55, #0b0a0e 70%);perspective:1400px;display:flex;align-items:center;justify-content:center`;
      paper = document.createElement("div");
      paper.style.cssText = "position:relative;width:min(84vw,150vh);height:min(52vh,47vw);transform-style:preserve-3d;will-change:transform";
      const title = titleOf(env);
      const long = title.length > 18;
      let parent: HTMLElement = paper;
      for (let i = 0; i < N; i++) {
        const s = document.createElement("div");
        s.style.cssText = `position:absolute;top:0;${i === 0 ? "left:0" : "left:100%"};width:${i === 0 ? 100 / N : 100}%;height:100%;transform-origin:0 50%;transform-style:preserve-3d;will-change:transform`;
        const face = document.createElement("div");
        face.style.cssText = `position:absolute;inset:0;overflow:hidden;background:${i % 2 ? "#f3efe6" : "#fbf8f1"};backface-visibility:visible`;
        const inner = document.createElement("div");
        inner.style.cssText = `position:absolute;top:0;left:${-i * 100}%;width:${N * 100}%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 4%;box-sizing:border-box`;
        const tt = document.createElement("div");
        tt.textContent = title;
        tt.style.cssText = `font-family:${WIDE};font-size:min(${long ? 5.2 : 8.5}vw,${long ? 9 : 15}vh);line-height:1;color:${c1};text-shadow:.04em .04em 0 ${c2};max-height:68%;overflow:hidden;word-break:break-word`;
        const ln = document.createElement("div");
        ln.style.cssText = `margin-top:.8em;font:600 min(2.6vw,4.4vh)/1.2 ${SANS};color:#222;letter-spacing:.02em;max-width:90%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis`;
        ln.textContent = artistOf(env);
        inner.append(tt, ln);
        face.appendChild(inner);
        const sh = document.createElement("div");
        sh.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none";
        face.appendChild(sh);
        s.appendChild(face);
        parent.appendChild(s);
        parent = s;
        strips.push(s); shades.push(sh); lines.push(ln); titles.push(tt);
      }
      root.appendChild(paper);
      host.appendChild(root);
      lastSerial = -1;
    },
    frame(dt, t, s, env) {
      if (!paper) return;
      lyr.update(env, t, s);
      if (lyr.serial !== lastSerial) {
        lastSerial = lyr.serial;
        const txt = lyr.real ? lyr.text : artistOf(env);
        for (const l of lines) l.textContent = txt;
      }
      const calm = s.section === "intro" || s.section === "breakdown" || s.section === "outro";
      const target = env.reduceMotion ? 0.8 : Math.min(1, (calm ? 0.25 : 0.45) + 0.35 * s.bass + 0.35 * s.beat + s.drop);
      open = env.reduceMotion ? target : damp(open, target, s.beat > 0.5 ? 14 : 4, dt);
      if (s.drop > 0.95 && spinV < 1) spinV = 360 * 1.6;
      spin += spinV * dt;
      spinV = damp(spinV, 0, 1.6, dt);
      if (spinV < 2) spin = damp(spin, Math.round(spin / 360) * 360, 3, dt);
      // ângulo da dobra: fechado = 80°, aberto = 0
      const a = (1 - open) * 78;
      for (let i = 0; i < N; i++) {
        const ang = i === 0 ? 0 : i % 2 ? -a * 2 : a * 2;
        strips[i].style.transform = i === 0 ? `rotateY(${a}deg)` : `rotateY(${ang}deg)`;
        const facing = i % 2 ? 1 : -1;
        shades[i].style.opacity = String(Math.max(0, 0.05 + facing * (a / 78) * 0.45 + (i % 2 ? 0.1 : 0)));
      }
      const width = 1 - (1 - Math.cos((a * Math.PI) / 180)) * 1;
      const sway = env.reduceMotion ? 0 : Math.sin(t * 0.5) * 8;
      paper.style.transform = `translateX(${(1 - width) * 42}%) rotateX(${14 + sway * 0.5}deg) rotateY(${spin + sway}deg) scale(${1 + 0.03 * s.beat})`;
    },
    unmount() {
      root?.remove();
      root = paper = null;
      strips.length = shades.length = lines.length = titles.length = 0;
    },
  };
});
