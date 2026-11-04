/**
 * O título da música em 3D, extrudido em camadas como o antigo nome do
 * omelhorsite na barra (24 cópias em translateZ), a girar devagar e a
 * ressaltar pelo ecrã; cada batida dá-lhe um pulo e um empurrão na rotação.
 */
import { domScene } from "../../lib/dom";

export default domScene({
  id: "text3d",
  name: "Título 3D",
  names: { en: "3D title", lv: "3D nosaukums" },
  families: ["retro", "chaos"],
  tags: ["texto", "3d", "omelhorsite"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "title", "palette"],
  lyrics: "extrude",
}, () => {
  let root: HTMLDivElement | null = null;
  let spinner: HTMLDivElement | null = null;
  let layers: HTMLSpanElement[] = [];
  let shown = "";
  let x = 0.2, y = 0.3, vx = 0.11, vy = 0.08, spin = 0, kick = 0, hue = 0;
  const build = (text: string, colors: [string, string, string]) => {
    if (!spinner) return;
    spinner.innerHTML = "";
    layers = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const l = document.createElement("span");
      l.textContent = text;
      l.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;transform:translateZ(${(i - n / 2) * 1.1}px);color:${i === n - 1 ? "#fff" : i === 0 ? colors[0] : colors[1]};${i > 0 && i < n - 1 ? "filter:brightness(.45);" : ""}`;
      spinner.appendChild(l);
      layers.push(l);
    }
    const ghost = document.createElement("span");
    ghost.textContent = text;
    ghost.style.cssText = "visibility:hidden;white-space:nowrap";
    spinner.appendChild(ghost);
    shown = text;
  };
  return {
    mount(host, env) {
      root = document.createElement("div");
      root.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#000;perspective:700px";
      spinner = document.createElement("div");
      spinner.style.cssText = "position:absolute;font-family:OMSWide,system-ui,sans-serif;font-size:min(9vw,96px);line-height:1;transform-style:preserve-3d;will-change:transform";
      root.appendChild(spinner);
      host.appendChild(root);
      build(env.title || "OMS", env.colors);
    },
    frame(dt, t, s, env, w, h) {
      if (!root || !spinner) return;
      if ((env.title || "OMS") !== shown) build(env.title || "OMS", env.colors);
      const bw = spinner.offsetWidth / w, bh = spinner.offsetHeight / h;
      const sp = 1 + 1.5 * s.energy;
      x += vx * dt * sp; y += vy * dt * sp;
      if (x < 0 || x + bw > 1) { vx *= -1; x = Math.max(0, Math.min(1 - bw, x)); hue += 60; }
      if (y < 0 || y + bh > 1) { vy *= -1; y = Math.max(0, Math.min(1 - bh, y)); hue += 60; }
      kick = Math.max(kick * Math.exp(-dt * 3), s.beat > 0.9 ? 1 : 0);
      spin += dt * (40 + 220 * kick);
      const tilt = -18 * Math.sin((spin / 360) * Math.PI * 2);
      const scale = 1 + 0.15 * s.beat + 0.1 * s.bass;
      spinner.style.left = `${x * 100}%`;
      spinner.style.top = `${y * 100}%`;
      spinner.style.transform = `rotateY(${spin % 360}deg) rotateX(${tilt}deg) scale(${scale})`;
      spinner.style.filter = `hue-rotate(${hue + t * 8}deg)`;
    },
    unmount() {
      root?.remove();
      root = spinner = null;
      layers = [];
      shown = "";
    },
  };
});
