/**
 * O motor visual (/viz/). Ver README.md. Uma página, três camadas (WebGL,
 * Canvas 2D, DOM) e uma camada de efeitos; uma cena de cada vez. As cenas
 * vivem em viz/scenes/<pacote>/<id>.ts, cada uma no seu pedaço de JS que só
 * se carrega quando é precisa (o índice, gerado, só traz o meta).
 */
import { hexToVec, textureFrom } from "./lib/gl";
import { lerp } from "./lib/ease";
import type { FrameInfo, SceneEnv, SceneHost, SceneInstance, SceneLayer, SceneMeta, SceneModule } from "./lib/scene";
import { type FromViz, type LyricsMode, type SceneName, type ToViz, type VizFx, type VizSection, type VizSong } from "./protocol";
import { decode, sample, sectionAt, Smoother, type Decoded, type Signal } from "./signal";
import { Overlays, type LyricStyle } from "./overlays";
import { familyFor, localBagStore, ScenePicker, type PickContext } from "./selector";
import { SCENES } from "./scenes/_registry";

const BACKGROUND: SceneName = "aurora";
const byId = new Map(SCENES.map((e) => [e.meta.id, e]));
const metaOf = (id: SceneName): SceneMeta | undefined => byId.get(id)?.meta;
const query = new URLSearchParams(location.search);
const devMode = query.has("gallery") || query.has("test");

// ---------------------------------------------------------------- estado
let song: VizSong | null = null;
let playing = false;
let basePos = 0;
let baseAt = Date.now();
const analyses = new Map<string, Decoded | null>();
let colors: [string, string, string] = ["#6b5bd6", "#e2557a", "#2bb3a6"];
let mode: "background" | "full" = "background";
/** A cena pedida (pode ainda estar a carregar). */
let scene: SceneName = BACKGROUND;
let chaos = false;
let fx: VizFx = { crt: false, chroma: false, pixel: false, dither: false };
let reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
let paused = false;
let selection: "random" | "style" = "random";
let favorites: SceneName[] = [];
let banned: SceneName[] = [];
let cycleOnTrack = true;
/** As cenas que falharam a carregar ou a correr nesta sessão: ficam de fora. */
const broken = new Set<SceneName>();
const picker = new ScenePicker(SCENES.map((e) => e.meta), devMode ? undefined : localBagStore());
const overlays = new Overlays();
let lyricsMode: LyricsMode = "sometimes";
/** Que visual teve cada grupo de secções nesta música (o refrão que volta traz o mesmo). */
let groupScene = new Map<number, SceneName>();
let lastSection = -2;
let lastSwitchAt = 0;
let emaShort = 0.5;
let emaLong = 0.5;
let flashUntil = 0;
const history: SceneName[] = [];
let cover: HTMLImageElement | null = null;
let coverTex: WebGLTexture | null = null;
let coverForGl = false;
let dirty = true;
/** Galeria/testes: a estrutura da música não muda a cena. */
let locked = false;
/** Testes: o relógio do rAF não desenha, quem manda é o harness. */
let manual = false;

/**
 * O nível do aparelho: 1 fraco (poupança, poucos núcleos), 2 telemóvel ou
 * portátil modesto, 3 computador. Desce sozinho se uma cena cara não
 * aguentar (ver `adapt`).
 */
const deviceTier = (): 1 | 2 | 3 => {
  if (lowPower) return 1;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (matchMedia("(pointer: coarse)").matches || cores < 8) return 2;
  return 3;
};
let tierCap: 1 | 2 | 3 = 3;
const tier = () => Math.min(deviceTier(), tierCap) as 1 | 2 | 3;

// ---------------------------------------------------------------- camadas
document.body.style.cssText = "margin:0;background:#000;overflow:hidden;width:100vw;height:100vh";
const stage = document.createElement("div");
stage.style.cssText = "position:fixed;inset:0;transition:filter .3s";
document.body.appendChild(stage);
const glCanvas = document.createElement("canvas");
const c2 = document.createElement("canvas");
const dom = document.createElement("div");
for (const el of [glCanvas, c2, dom]) {
  // nos testes sem transição: a captura logo a seguir à troca não apanha a cena anterior a sair
  el.style.cssText = `position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:${query.has("test") ? "none" : "opacity .35s ease"}`;
  stage.appendChild(el);
}
const layerEl: Record<SceneLayer, HTMLElement> = { gl: glCanvas, "2d": c2, dom };
const fxLayer = document.createElement("div");
fxLayer.style.cssText = "position:fixed;inset:0;pointer-events:none";
document.body.appendChild(fxLayer);
document.body.insertAdjacentHTML(
  "beforeend",
  `<svg width="0" height="0" style="position:absolute"><filter id="chroma"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" in="SourceGraphic" result="r"/><feOffset in="r" dx="-4" dy="0" result="r2"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" in="SourceGraphic" result="gb"/><feOffset in="gb" dx="3" dy="0" result="gb2"/><feBlend in="r2" in2="gb2" mode="screen"/></filter></svg>`,
);
const fontFace = new FontFace("OMSWide", "url(./omswide.ttf)");
fontFace.load().then((f) => document.fonts.add(f)).catch(() => {});

const gl = glCanvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: query.has("test"), powerPreference: "high-performance" });
const ctx2 = c2.getContext("2d");
const smoother = new Smoother();

/** O que as cenas vêem; o motor muta-o (as cenas não guardam cópias). */
const env: SceneEnv = {
  colors,
  colorVecs: colors.map(hexToVec),
  title: "",
  artist: "",
  cover: null,
  coverTex: null,
  lyric: "",
  lowPower,
  tier: tier(),
  reduceMotion,
  fx: { pixel: false, dither: false },
};
const syncEnv = () => {
  env.colors = colors;
  env.title = song?.title ?? "";
  env.artist = song?.artist ?? "";
  env.cover = cover;
  env.coverTex = coverForGl && coverTex ? coverTex : null;
  env.lowPower = lowPower;
  env.tier = tier();
  env.reduceMotion = reduceMotion;
  env.fx.pixel = fx.pixel;
  env.fx.dither = fx.dither;
};
const host = (layer: SceneLayer): SceneHost => ({ layer, gl: layer === "gl" ? gl : null, ctx: layer === "2d" ? ctx2 : null, root: dom, env });

const post = (msg: FromViz) => {
  const rn = (window as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView;
  if (rn) rn.postMessage(JSON.stringify(msg));
  else if (window.parent !== window) window.parent.postMessage({ __viz: true, ...msg }, location.origin);
};

// ---------------------------------------------------------------- tamanho
let W = 0, H = 0;
const layerSize = (layer: SceneLayer): [number, number] =>
  layer === "gl" ? [W, H] : layer === "2d" ? [c2.width, c2.height] : [innerWidth, innerHeight];
const resize = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.5) * (lowPower ? 0.6 : 1) * (mode === "background" ? 0.5 : 1);
  W = Math.max(1, Math.round(innerWidth * dpr));
  H = Math.max(1, Math.round(innerHeight * dpr));
  const px = fx.pixel ? 0.25 : 1;
  glCanvas.width = Math.round(W);
  glCanvas.height = Math.round(H);
  c2.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2) * px);
  c2.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 2) * px);
  c2.style.imageRendering = fx.pixel ? "pixelated" : "auto";
  if (current) current.inst.resize?.(...layerSize(current.meta.layer));
  dirty = true;
};
addEventListener("resize", resize);

// ---------------------------------------------------------------- capa
/**
 * A capa para o WebGL precisa de CORS. O /media/:id/data do backend só
 * responde com sessão e redirecciona para o MinIO, o que um pedido anónimo
 * (crossOrigin) não consegue seguir; por isso pede-se primeiro o URL assinado
 * (/media/:id/data_url, com a sessão: o cookie na web, o ?token= no nativo) e
 * carrega-se esse, que o MinIO serve com CORS aberto.
 */
const resolveCoverUrl = async (url: string): Promise<string> => {
  const m = url.match(/^(.*\/media\/[^/?]+)\/data(\?.*)?$/);
  if (!m) return url;
  try {
    const res = await fetch(`${m[1]}/data_url${m[2] ?? ""}`, { credentials: "include" });
    if (!res.ok) return url;
    const body = (await res.json()) as { url?: string };
    return body.url || url;
  } catch {
    return url;
  }
};

let coverToken = 0;
const loadCover = (raw: string | null) => {
  cover = null;
  coverForGl = false;
  syncEnv();
  if (!raw) return;
  const token = ++coverToken;
  void resolveCoverUrl(raw).then((url) => {
    if (token === coverToken) loadCoverImage(url);
  });
};

const loadCoverImage = (url: string) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    cover = img;
    coverForGl = true;
    if (gl) {
      try {
        if (coverTex) gl.deleteTexture(coverTex);
        coverTex = textureFrom(gl, img);
      } catch {
        coverForGl = false;
      }
    }
    syncEnv();
    dirty = true;
  };
  img.onerror = () => {
    // Sem CORS: a capa serve ao DOM (janelas), não ao WebGL.
    const plain = new Image();
    plain.onload = () => { cover = plain; syncEnv(); dirty = true; };
    plain.src = url;
  };
  img.src = url;
};

// ---------------------------------------------------------------- cenas
const modules = new Map<SceneName, Promise<SceneModule>>();
const loadModule = (id: SceneName): Promise<SceneModule> => {
  let p = modules.get(id);
  if (!p) {
    const entry = byId.get(id);
    p = entry ? entry.load().then((m) => m.default) : Promise.reject(new Error(`cena desconhecida: ${id}`));
    p.catch(() => modules.delete(id));
    modules.set(id, p);
  }
  return p;
};

let current: { id: SceneName; meta: SceneMeta; inst: SceneInstance } | null = null;
let sceneToken = 0;

const resetLayers = () => {
  if (gl) {
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
  }
  if (ctx2) {
    (ctx2 as { reset?: () => void }).reset?.();
    ctx2.fillStyle = "#000";
    ctx2.fillRect(0, 0, c2.width, c2.height);
  }
};

const disposeCurrent = () => {
  if (!current) return;
  try { current.inst.dispose?.(); } catch (e) { console.warn("viz: dispose", current.id, e); }
  current = null;
};

/**
 * Uma cena falhou: fica de fora nesta sessão e passa-se à seguinte. Se o
 * pedaço de JS nem chega (um viz.js antigo em cache a pedir pedaços que já
 * não existem depois de um deploy), recarrega-se a página uma vez; e três
 * falhas seguidas param as tentativas, para não andar em roda.
 */
let failStreak = 0;
const fail = (id: SceneName, e: unknown) => {
  console.error(`viz: a cena "${id}" falhou`, e);
  broken.add(id);
  if (current?.id === id) disposeCurrent();
  failStreak++;
  const fetchFailed = /dynamically imported|module script|Importing a module|Failed to fetch|Load failed/i.test(String((e as Error)?.message ?? e));
  if (fetchFailed && !devMode) {
    try {
      const k = "oms-viz-reloaded";
      if (Date.now() - Number(sessionStorage.getItem(k) ?? 0) > 60000) {
        sessionStorage.setItem(k, String(Date.now()));
        location.reload();
        return;
      }
    } catch { /* sem sessionStorage: segue */ }
  }
  if (failStreak >= 3) return;
  if (mode === "full" && !locked && scene === id) step(1);
  else if (id === BACKGROUND) glCanvas.style.opacity = "0";
};

/** Trocar de cena: carrega o pedaço (se ainda não veio), cria, e só então troca; até lá a anterior continua. */
const setScene = async (next: SceneName): Promise<void> => {
  if (!byId.has(next)) next = BACKGROUND;
  scene = next;
  const token = ++sceneToken;
  let mod: SceneModule;
  try {
    mod = await loadModule(next);
  } catch (e) {
    if (token === sceneToken) fail(next, e);
    return;
  }
  if (token !== sceneToken) return;
  disposeCurrent();
  resetLayers();
  const meta = mod.meta;
  const inst = mod.create();
  try {
    await inst.init?.(host(meta.layer));
    if (token !== sceneToken) { inst.dispose?.(); return; }
    inst.resize?.(...layerSize(meta.layer));
  } catch (e) {
    try { inst.dispose?.(); } catch { /* já falhou */ }
    if (token === sceneToken) fail(next, e);
    return;
  }
  current = { id: next, meta, inst };
  failStreak = 0;
  for (const l of ["gl", "2d", "dom"] as const) layerEl[l].style.opacity = l === meta.layer ? "1" : "0";
  post({ type: "scene", name: next, label: meta.name });
  dirty = true;
  if (mode === "full" && !devMode) prefetch();
};

/** Pré-carregar a que vem a seguir no baralho (e mandar compilar o shader dela, sem esperar). */
const prefetch = () => {
  const id = picker.peek(pickContext());
  const go = () => loadModule(id).then((m) => { if (gl && m.prewarm) m.prewarm(gl); }).catch(() => {});
  const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(go, { timeout: 4000 });
  else setTimeout(go, 1500);
};

const pickContext = (intensity?: number): PickContext => {
  const d = song ? analyses.get(song.id) ?? null : null;
  return {
    selection,
    family: familyFor(song, d),
    favorites,
    banned: broken.size ? [...banned, ...broken] : banned,
    tier: tier(),
    songTags: (song?.tags ?? []).join(" ").toLowerCase(),
    intensity,
  };
};

/** Seguinte: o escolhedor (aleatório ou pelo estilo). Anterior: a que passou antes. */
const step = (dir: 1 | -1, intensity?: number) => {
  if (dir === -1 && history.length > 1) {
    history.pop();
    const back = history[history.length - 1];
    void setScene(back);
    return;
  }
  const next = picker.next(pickContext(intensity));
  history.push(next);
  if (history.length > 30) history.shift();
  void setScene(next);
};

const applyFx = () => {
  const parts: string[] = [];
  if (fx.crt) parts.push("repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 1px,transparent 1px 3px)", "radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.55) 100%)");
  fxLayer.style.background = parts.join(",");
  stage.style.filter = [fx.chroma ? "url(#chroma)" : "", fx.crt ? "contrast(1.15) saturate(1.2)" : ""].join(" ").trim();
  syncEnv();
  resize();
};

// ---------------------------------------------------------------- mensagens
const handle = (msg: ToViz) => {
  switch (msg.type) {
    case "state": {
      const changed = msg.song?.id !== song?.id;
      song = msg.song;
      playing = msg.playing;
      basePos = msg.position;
      baseAt = msg.at;
      if (changed) {
        loadCover(song?.artworkUrl ?? null);
        syncEnv();
        groupScene = new Map();
        lastSection = -2;
        lastSwitchAt = msg.position;
        if (mode === "full" && cycleOnTrack && song && !locked) {
          step(1);
          overlays.titleCard(song);
        } else current?.inst.song?.();
      }
      dirty = true;
      break;
    }
    case "analysis":
      analyses.set(msg.songId, msg.data ? decode(msg.data) : null);
      if (analyses.size > 12) analyses.delete(analyses.keys().next().value!);
      break;
    case "lyrics":
      overlays.setLyrics(msg.songId, msg.lines);
      break;
    case "palette":
      colors = msg.colors;
      syncEnv();
      dirty = true;
      break;
    case "config": {
      const prevMode = mode;
      mode = msg.mode;
      if (msg.chaos !== undefined) chaos = msg.chaos;
      if (msg.fx) fx = { ...fx, ...msg.fx };
      if (msg.reduceMotion !== undefined) reduceMotion = msg.reduceMotion;
      if (msg.lowPower !== undefined) lowPower = msg.lowPower;
      if (msg.paused !== undefined) paused = msg.paused;
      if (msg.selection) selection = msg.selection;
      if (msg.favorites) favorites = msg.favorites;
      if (msg.banned) banned = msg.banned;
      if (msg.cycleOnTrack !== undefined) cycleOnTrack = msg.cycleOnTrack;
      if (msg.lyrics) lyricsMode = msg.lyrics;
      syncEnv();
      if (mode !== "full") overlays.clearAll();
      if (mode === "background") {
        if (scene !== BACKGROUND || prevMode !== mode) { resize(); void setScene(BACKGROUND); }
      } else if (msg.scene && msg.scene !== scene && byId.has(msg.scene)) {
        resize();
        picker.saw(msg.scene);
        history.push(msg.scene);
        void setScene(msg.scene);
      } else if (prevMode !== "full" || scene === BACKGROUND || banned.includes(scene)) {
        resize();
        step(1);
      }
      applyFx();
      break;
    }
    case "next":
      if (mode === "full") step(msg.dir);
      break;
  }
};
addEventListener("message", (e) => {
  if (e.origin !== location.origin && e.origin !== "null") return;
  const data = e.data as ToViz | string;
  handle(typeof data === "string" ? (JSON.parse(data) as ToViz) : data);
});
(window as unknown as { __viz: (m: ToViz) => void }).__viz = handle;
addEventListener("keydown", (e) => {
  if (mode !== "full" || devMode) return;
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
});

// ---------------------------------------------------------------- frames
const position = () => basePos + (playing ? (Date.now() - baseAt) / 1000 : 0);
let last = performance.now();
let tAcc = 0;
const frameTimes: number[] = [];
let lastReport = performance.now();
const frameInfo: FrameInfo = { dt: 0, w: 0, h: 0 };
let targetFor: [string, string, string] | null = null;
let targetVecs: [number, number, number][] = [];

/** Um frame da cena actual (o rAF e o harness passam por aqui). */
const drawFrame = (dt: number, t: number, s: Signal) => {
  const cv = env.colorVecs;
  if (colors !== targetFor) { targetFor = colors; targetVecs = colors.map(hexToVec); }
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) cv[i][k] = lerp(cv[i][k], targetVecs[i][k], 0.04);
  if (!current) return;
  env.lyric = overlays.currentLine(position());
  const [w, h] = layerSize(current.meta.layer);
  frameInfo.dt = dt;
  frameInfo.w = w;
  frameInfo.h = h;
  try {
    current.inst.frame(t, s, frameInfo);
  } catch (e) {
    fail(current.id, e);
  }
};

/**
 * A estrutura da música manda nas mudanças (regra do dono: nada de mudar por
 * tempo). Fronteira grande (queda, refrão): visual novo, ou o mesmo do
 * primeiro refrão quando o grupo volta, com um clarão; a capa entra e a letra
 * fica à vista. Fronteira pequena: só a paleta roda e os efeitos mexem.
 * Sem secções (análise a chegar): saltos de energia ao vivo; em último caso,
 * uma mudança a cada 2,5 minutos.
 */
const structure = (d: Decoded | null, s: Signal) => {
  const pos = position();
  if (d && d.sections.length) {
    const si = sectionAt(d, pos);
    if (lastSection === -2) { lastSection = si; return; }
    if (si === lastSection || si < 0) return;
    lastSection = si;
    boundary(d.sections[si], pos);
    return;
  }
  emaShort += (s.energy - emaShort) * 0.08;
  emaLong += (s.energy - emaLong) * 0.008;
  const since = pos - lastSwitchAt;
  if (s.real && emaShort - emaLong > 0.22 && emaLong < 0.6 && since > 20) {
    boundary({ t: pos, type: "drop", intensity: emaShort, group: -1, big: true }, pos);
  } else if (since > 150) {
    boundary({ t: pos, type: "verse", intensity: 0.5, group: -1, big: true }, pos);
  }
};

const boundary = (sec: VizSection, pos: number) => {
  lastSwitchAt = pos;
  const artOk = metaOf(scene)?.artwork !== "own";
  if ((sec.big || chaos) && !locked) {
    const back = sec.group >= 0 ? groupScene.get(sec.group) : undefined;
    if (back && !banned.includes(back) && !broken.has(back) && back !== scene && !chaos) {
      picker.saw(back);
      history.push(back);
      void setScene(back);
    } else {
      step(1, sec.intensity);
      if (sec.group >= 0) groupScene.set(sec.group, scene);
    }
    flashUntil = performance.now() + (sec.type === "drop" ? 140 : 80);
    overlays.bigMoment(pos, artOk ? cover : null, sec.intensity);
    if (chaos) { fx = { crt: Math.random() < 0.5, chroma: Math.random() < 0.5, pixel: Math.random() < 0.2, dither: Math.random() < 0.3 }; applyFx(); }
  } else {
    colors = [colors[1], colors[2], colors[0]];
    syncEnv();
    overlays.minorMoment(artOk ? cover : null);
  }
};

const lyricStyle = (): LyricStyle => {
  const l = metaOf(scene)?.lyrics ?? "ink";
  return l === "own" ? "none" : l;
};

/** Uma cena cara a arrastar-se (menos de ~36 fps): o aparelho desce de nível e ela sai da rotação. */
let lastAdapt = 0;
const adapt = (avgMs: number) => {
  const m = current?.meta;
  if (!m || devMode || mode !== "full" || avgMs < 28 || m.cost < 2 || performance.now() - lastAdapt < 30000) return;
  const t = tier();
  if (m.cost < t || t === 1) return;
  lastAdapt = performance.now();
  tierCap = (m.cost - 1) as 1 | 2;
  syncEnv();
  console.info(`viz: "${m.id}" a ${Math.round(avgMs)} ms por frame; nível do aparelho -> ${tierCap}`);
};

const loop = (now: number) => {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused || document.hidden || manual) return;
  if (reduceMotion && !dirty) return;
  dirty = false;
  const t0 = performance.now();
  tAcc += reduceMotion ? 0 : dt;
  const d = song ? analyses.get(song.id) ?? null : null;
  const raw = sample(d, position(), playing);
  const s = reduceMotion ? { ...raw, beat: 0, onset: 0, drop: 0, energy: 0.5, bass: 0.4 } : smoother.step(raw, dt);
  if (mode === "full" && !reduceMotion) structure(d, s);
  if (mode === "full") {
    const pos = position();
    const si = sectionAt(d, pos);
    overlays.frame(pos, lyricsMode, lyricStyle(), si >= 0 && d ? d.sections[si] : null, colors[1], song?.id);
  }
  if (performance.now() < flashUntil) stage.style.filter = "brightness(2.2) contrast(1.3)";
  else if (flashUntil) { flashUntil = 0; applyFxFilterOnly(); }
  drawFrame(dt, tAcc, s);
  const ft = performance.now() - t0;
  frameTimes.push(dt * 1000, ft);
  if (now - lastReport > 2000 && frameTimes.length > 20) {
    const intervals = frameTimes.filter((_, i) => i % 2 === 0).sort((a, b) => a - b);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const p95 = intervals[Math.floor(intervals.length * 0.95)];
    const dropped = intervals.reduce((n, v) => n + Math.max(0, Math.round(v / 16.67) - 1), 0);
    post({ type: "frames", avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(p95 * 10) / 10, fps: Math.round(1000 / avg), dropped, scene });
    adapt(avg);
    frameTimes.length = 0;
    lastReport = now;
  }
};
const applyFxFilterOnly = () => {
  stage.style.filter = [fx.chroma ? "url(#chroma)" : "", fx.crt ? "contrast(1.15) saturate(1.2)" : ""].join(" ").trim();
};

/** O que a galeria e o harness usam (viz/dev/). Não é API para a app: a app fala por mensagens. */
export interface Engine {
  scenes: typeof SCENES;
  handle: (m: ToViz) => void;
  setScene: (id: SceneName) => Promise<void>;
  /** Tirar a cena actual (dispose) e limpar as camadas. */
  clear: () => void;
  current: () => { id: SceneName; meta: SceneMeta } | null;
  lock: (on: boolean) => void;
  manual: (on: boolean) => void;
  drawFrame: (dt: number, t: number, s: Signal) => void;
  signalAt: (t: number) => Signal;
  smooth: (s: Signal, dt: number) => Signal;
  gl: WebGL2RenderingContext | null;
  ctx2: CanvasRenderingContext2D | null;
  dom: HTMLElement;
  layerSize: (l: SceneLayer) => [number, number];
  broken: Set<SceneName>;
  env: SceneEnv;
}

resize();
void setScene(BACKGROUND);
requestAnimationFrame(loop);
document.addEventListener("visibilitychange", () => { last = performance.now(); dirty = true; });
post({ type: "catalog", scenes: SCENES.filter((e) => !e.meta.background).map(({ pack, meta: m }) => ({ id: m.id, name: m.name, names: m.names, pack, families: m.families, intensity: m.intensity, cost: m.cost })) });
post({ type: "ready" });

if (devMode) {
  const engine: Engine = {
    scenes: SCENES,
    handle,
    setScene,
    clear: () => { sceneToken++; disposeCurrent(); resetLayers(); },
    current: () => (current ? { id: current.id, meta: current.meta } : null),
    lock: (on) => { locked = on; },
    manual: (on) => { manual = on; },
    drawFrame,
    signalAt: (t) => sample(song ? analyses.get(song.id) ?? null : null, t, true),
    smooth: (s, dt) => smoother.step(s, dt),
    gl,
    ctx2,
    dom,
    layerSize,
    broken,
    env,
  };
  if (query.has("test")) void import("./dev/harness").then((m) => m.start(engine));
  else void import("./dev/gallery").then((m) => m.start(engine));
}
