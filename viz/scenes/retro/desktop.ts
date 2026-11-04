/** Um ambiente de trabalho falso: janelas que nascem nas batidas, tremem e falham. */
import { domScene } from "../../lib/dom";

const TITLES = [
  "A tocar.exe", "Batida detectada", "Graves.dll", "Aviso", "Erro: demasiado bom", "Volume no máximo",
  "Leitor de multimédia", "A copiar música…", "Novo ficheiro", "Não desligues o computador", "Disquete cheia", "Ligação estabelecida",
];

export default domScene({
  id: "desktop",
  name: "Ambiente de trabalho",
  names: { en: "Desktop", lv: "Darbvirsma" },
  families: ["retro", "chaos"],
  tags: ["janelas", "computador", "humor"],
  intensity: 5,
  cost: 2,
  signals: ["energy", "beat", "cover", "title", "palette"],
  lyrics: "glitch",
}, () => {
  let root: HTMLDivElement | null = null;
  let wins: { el: HTMLDivElement; born: number; vx: number; vy: number; x: number; y: number }[] = [];
  let lastBeat = -1;
  const spawn = (t: number, env: { colors: [string, string, string]; title: string; artist: string; cover: HTMLImageElement | null }, w: number, h: number) => {
    if (!root) return;
    const el = document.createElement("div");
    const ww = 180 + Math.random() * 200;
    const kind = Math.random();
    const title = kind < 0.25 ? `${env.title || "Música"}.mp3` : TITLES[(Math.random() * TITLES.length) | 0];
    el.style.cssText = `position:absolute;width:${ww}px;background:#d4d0c8;border:2px solid;border-color:#fff #404040 #404040 #fff;box-shadow:2px 2px 0 #000;font:12px Tahoma,Verdana,system-ui,sans-serif;color:#000;will-change:transform`;
    const bar = `<div style="height:20px;display:flex;align-items:center;justify-content:space-between;padding:0 3px;color:#fff;font-weight:bold;background:linear-gradient(90deg,${env.colors[0]},${env.colors[1]})"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title.replace(/</g, "&lt;")}</span><span style="display:flex;gap:2px">${["_", "□", "×"].map((c) => `<b style="width:16px;height:14px;background:#d4d0c8;color:#000;display:inline-flex;align-items:center;justify-content:center;border:1px solid;border-color:#fff #404040 #404040 #fff;font-size:10px">${c}</b>`).join("")}</span></div>`;
    let body: string;
    if (kind < 0.25 && env.cover) body = `<img src="${env.cover.src}" style="display:block;width:100%;aspect-ratio:1;object-fit:cover">`;
    else if (kind < 0.55) body = `<div style="padding:10px">${(env.artist || "").replace(/</g, "&lt;")}<div style="margin-top:8px;height:16px;border:1px solid #808080;background:#fff"><div class="pg" style="height:100%;width:10%;background:repeating-linear-gradient(90deg,${env.colors[2]} 0 10px,transparent 10px 12px)"></div></div></div>`;
    else body = `<div style="padding:12px;display:flex;gap:10px;align-items:center"><b style="font-size:28px;color:${env.colors[0]}">!</b>${["A música está boa de mais.", "Encontrámos uma batida.", "Queres continuar a dançar?", "O ficheiro não cabe em 1,44 MB."][(Math.random() * 4) | 0]}</div><div style="text-align:center;padding-bottom:10px"><span style="display:inline-block;padding:3px 18px;border:2px solid;border-color:#fff #404040 #404040 #fff">OK</span></div>`;
    el.innerHTML = bar + body;
    const x = Math.random() * Math.max(10, w - ww), y = Math.random() * Math.max(10, h - 200);
    root.appendChild(el);
    wins.push({ el, born: t, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, x, y });
    if (wins.length > 14) wins.shift()!.el.remove();
  };
  return {
    mount(host, env) {
      root = document.createElement("div");
      root.style.cssText = `position:absolute;inset:0;overflow:hidden;background:${env.colors[2]};background-image:radial-gradient(rgba(255,255,255,.08) 1px,transparent 1px);background-size:16px 16px`;
      const task = document.createElement("div");
      task.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:30px;background:#d4d0c8;border-top:2px solid #fff;display:flex;align-items:center;padding:0 4px;font:bold 12px Tahoma,system-ui,sans-serif;gap:6px;z-index:9";
      task.innerHTML = `<span style="padding:3px 10px;border:2px solid;border-color:#fff #404040 #404040 #fff">♪ Começar</span><span class="clock" style="margin-left:auto;padding:3px 8px;border:1px solid;border-color:#808080 #fff #fff #808080"></span>`;
      root.appendChild(task);
      host.appendChild(root);
      void env;
    },
    frame(dt, t, s, env, w, h) {
      if (!root) return;
      const b = Math.floor(s.beatPos);
      if (b !== lastBeat) {
        lastBeat = b;
        if (Math.random() < 0.6 + 0.4 * s.energy) spawn(t, env, w, h);
      }
      const clock = root.querySelector(".clock");
      if (clock) clock.textContent = new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
      for (const win of wins) {
        win.x += win.vx * dt; win.y += win.vy * dt;
        const glitch = s.beat > 0.8 && Math.random() < 0.3;
        const jx = glitch ? (Math.random() - 0.5) * 30 : 0;
        win.el.style.transform = `translate(${win.x + jx}px,${win.y}px)`;
        win.el.style.filter = glitch ? `hue-rotate(${Math.random() * 360}deg) contrast(1.4)` : "none";
        const pg = win.el.querySelector<HTMLDivElement>(".pg");
        if (pg) pg.style.width = `${Math.min(100, ((t - win.born) * 25 * (0.5 + s.energy)) % 100)}%`;
      }
    },
    unmount() {
      root?.remove();
      root = null;
      wins = [];
    },
  };
});
