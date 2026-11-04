/**
 * A galeria (/viz/?gallery): todas as cenas com a música de teste, para ver
 * e comparar. Lista por pacote à direita (clicar para ver), setas para a
 * anterior/seguinte, e o meta de cada uma. `?gallery&scene=<id>` abre logo
 * uma; `&pack=<pacote>` mostra só esse pacote.
 */
import type { Engine } from "../main";
import { escapeHtml } from "../lib/text";
import { CANNED_DURATION } from "../lib/canned";
import { loadCanned } from "./canned-song";

export const start = async (e: Engine) => {
  const q = new URLSearchParams(location.search);
  const onlyPack = q.get("pack");
  const list = e.scenes.filter((s) => !onlyPack || s.pack === onlyPack);
  let idx = Math.max(0, list.findIndex((s) => s.meta.id === q.get("scene")));
  let sections = false;
  let lyrics = false;

  e.lock(true);
  await loadCanned(e, 24, true);

  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;top:0;right:0;bottom:0;width:300px;overflow:auto;background:rgba(10,10,10,.88);color:#eee;font:13px/1.35 system-ui,sans-serif;z-index:50;padding:12px 10px;box-sizing:border-box";
  document.body.appendChild(panel);
  const info = document.createElement("div");
  info.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:min(60vw,560px);background:rgba(0,0,0,.7);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:8px;z-index:50;pointer-events:none";
  document.body.appendChild(info);

  const btn = (label: string, on: boolean) => `<button style="font:inherit;padding:4px 8px;margin:0 4px 6px 0;border-radius:6px;border:1px solid #444;background:${on ? "#fff" : "#1b1b1b"};color:${on ? "#000" : "#eee"};cursor:pointer">${label}</button>`;
  const renderPanel = () => {
    const packs = [...new Set(list.map((s) => s.pack))];
    panel.innerHTML = `<div style="font-weight:700;font-size:15px;margin-bottom:6px">Galeria · ${list.length} cenas</div>
      <div data-ctl>${btn("Secções mudam a cena", sections)}${btn("Letra", lyrics)}${btn("Do início da queda", false)}</div>
      ${packs.map((p) => `<div style="margin:10px 0 4px;color:#9a9a9a;text-transform:uppercase;font-size:11px;letter-spacing:.08em">${escapeHtml(p)}</div>` +
        list.map((s, i) => (s.pack !== p ? "" : `<div data-i="${i}" style="padding:5px 6px;border-radius:6px;cursor:pointer;${i === idx ? "background:#fff;color:#000" : ""}">${escapeHtml(s.meta.name)} <span style="opacity:.55">${s.meta.id}${s.meta.background ? " · fundo" : ""}</span></div>`)).join("")).join("")}`;
  };
  const show = async (i: number) => {
    idx = (i + list.length) % list.length;
    renderPanel();
    const s = list[idx];
    const m = s.meta;
    info.innerHTML = `<b style="font-size:16px">${escapeHtml(m.name)}</b> <span style="opacity:.6">${s.pack}/${m.id}</span><br>
      famílias: ${m.families.join(", ")} · intensidade ${m.intensity}/5 · custo ${m.cost}/3 · camada ${m.layer}<br>
      sinais: ${m.signals.join(", ") || "—"} · letra: ${m.lyrics}${m.tags.length ? `<br>etiquetas: ${m.tags.map(escapeHtml).join(", ")}` : ""}
      <div data-err style="color:#ff7a7a"></div>`;
    e.handle({ type: "config", mode: "full", scene: m.id, lyrics: lyrics ? "always" : "never", cycleOnTrack: false });
    await e.setScene(m.id);
    const err = info.querySelector<HTMLDivElement>("[data-err]");
    if (err && e.broken.has(m.id)) err.textContent = "Falhou (ver a consola).";
    history.replaceState(null, "", `?gallery${onlyPack ? `&pack=${onlyPack}` : ""}&scene=${m.id}`);
  };
  panel.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (el) { void show(Number(el.dataset.i)); return; }
    const b = (ev.target as HTMLElement).closest("button");
    if (!b) return;
    const label = b.textContent ?? "";
    if (label.startsWith("Secções")) { sections = !sections; e.lock(!sections); }
    else if (label === "Letra") { lyrics = !lyrics; e.handle({ type: "config", mode: "full", lyrics: lyrics ? "always" : "never" }); }
    else { from = 27; started = Date.now(); void loadCanned(e, 27, true); }
    renderPanel();
  });
  addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") void show(idx + 1);
    if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") void show(idx - 1);
    if (ev.key === "h") panel.style.display = info.style.display = panel.style.display === "none" ? "" : "none";
  });
  // a música de teste em ciclo
  let from = 24, started = Date.now();
  setInterval(() => {
    if (from + (Date.now() - started) / 1000 > CANNED_DURATION - 1) { from = 0; started = Date.now(); void loadCanned(e, 0, true); }
  }, 1000);
  await show(idx);
};
