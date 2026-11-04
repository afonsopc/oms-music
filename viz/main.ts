/**
 * O motor visual (/viz/). Ver README.md. Uma página, três camadas (WebGL,
 * Canvas 2D, DOM) e uma camada de efeitos; uma cena de cada vez.
 */
import { compile, fullscreenTriangle, hexToVec, target, textureFrom, type Target } from "./gl";
import { FULL_SCENES, type FromViz, type SceneName, type ToViz, type VizFx, type VizSong } from "./protocol";
import { decode, sample, Smoother, type Decoded } from "./signal";
import { mystify, pipes, scope, starfield } from "./scenes/canvas";
import { desktop, text3d } from "./scenes/dom";
import { AURORA, CHROME, KALEIDO, MILK, PLASMA, TUNNEL } from "./scenes/shaders";
import type { Canvas2DScene, DomScene, SceneEnv } from "./scenes/types";

const GL_SOURCES: Partial<Record<SceneName, string>> = { aurora: AURORA, milk: MILK, kaleido: KALEIDO, tunnel: TUNNEL, plasma: PLASMA, chrome: CHROME };
const make2d: Partial<Record<SceneName, () => Canvas2DScene>> = { pipes, mystify, starfield, scope };
const makeDom: Partial<Record<SceneName, () => DomScene>> = { text3d, desktop };

// ---------------------------------------------------------------- estado
let song: VizSong | null = null;
let playing = false;
let basePos = 0;
let baseAt = Date.now();
const analyses = new Map<string, Decoded | null>();
let colors: [string, string, string] = ["#6b5bd6", "#e2557a", "#2bb3a6"];
let shownColors = colors.map(hexToVec) as [number, number, number][];
let mode: "background" | "full" = "background";
let scene: SceneName = "aurora";
let chaos = false;
let fx: VizFx = { crt: false, chroma: false, pixel: false, dither: false };
let reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
let paused = false;
let autoCycleBars = 16;
let cover: HTMLImageElement | null = null;
let coverTex: WebGLTexture | null = null;
let coverForGl = false;
let dirty = true;

// ---------------------------------------------------------------- camadas
document.body.style.cssText = "margin:0;background:#000;overflow:hidden;width:100vw;height:100vh";
const stage = document.createElement("div");
stage.style.cssText = "position:fixed;inset:0;transition:filter .3s";
document.body.appendChild(stage);
const glCanvas = document.createElement("canvas");
const c2 = document.createElement("canvas");
const dom = document.createElement("div");
for (const el of [glCanvas, c2, dom]) {
  el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .35s ease";
  stage.appendChild(el);
}
const fxLayer = document.createElement("div");
fxLayer.style.cssText = "position:fixed;inset:0;pointer-events:none";
document.body.appendChild(fxLayer);
document.body.insertAdjacentHTML(
  "beforeend",
  `<svg width="0" height="0" style="position:absolute"><filter id="chroma"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" in="SourceGraphic" result="r"/><feOffset in="r" dx="-4" dy="0" result="r2"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" in="SourceGraphic" result="gb"/><feOffset in="gb" dx="3" dy="0" result="gb2"/><feBlend in="r2" in2="gb2" mode="screen"/></filter></svg>`,
);
const fontFace = new FontFace("OMSWide", "url(./omswide.ttf)");
fontFace.load().then((f) => document.fonts.add(f)).catch(() => {});

const gl = glCanvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
const ctx2 = c2.getContext("2d");
const tri = gl ? fullscreenTriangle(gl) : null;
const programs = new Map<SceneName, WebGLProgram>();
let feedback: [Target, Target] | null = null;
let current2d: Canvas2DScene | null = null;
let currentDom: DomScene | null = null;
const smoother = new Smoother();

const post = (msg: FromViz) => {
  const rn = (window as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView;
  if (rn) rn.postMessage(JSON.stringify(msg));
  else if (window.parent !== window) window.parent.postMessage({ __viz: true, ...msg }, location.origin);
};

// ---------------------------------------------------------------- tamanho
let W = 0, H = 0;
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
  if (gl && feedback) feedback = null;
  current2d?.reset?.();
  dirty = true;
};
addEventListener("resize", resize);

// ---------------------------------------------------------------- capa
const loadCover = (url: string | null) => {
  cover = null;
  coverForGl = false;
  if (!url) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    cover = img;
    coverForGl = true;
    if (gl) {
      try {
        coverTex = textureFrom(gl, img);
      } catch {
        coverForGl = false;
      }
    }
    dirty = true;
  };
  img.onerror = () => {
    // Sem CORS: a capa serve ao DOM (janelas), não ao WebGL.
    const plain = new Image();
    plain.onload = () => { cover = plain; dirty = true; };
    plain.src = url;
  };
  img.src = url;
};

// ---------------------------------------------------------------- cenas
const isGl = (s: SceneName) => s in GL_SOURCES;
const setScene = (next: SceneName) => {
  if (currentDom) { currentDom.unmount(); currentDom = null; }
  current2d = null;
  scene = next;
  if (isGl(next) && gl) {
    if (!programs.has(next)) {
      try { programs.set(next, compile(gl, GL_SOURCES[next]!)); } catch (e) { console.warn(e); }
    }
    feedback = null;
  } else if (make2d[next]) {
    current2d = make2d[next]!();
  } else if (makeDom[next]) {
    currentDom = makeDom[next]!();
    currentDom.mount(dom, env());
  }
  glCanvas.style.opacity = isGl(next) ? "1" : "0";
  c2.style.opacity = make2d[next] ? "1" : "0";
  dom.style.opacity = makeDom[next] ? "1" : "0";
  if (ctx2) { ctx2.fillStyle = "#000"; ctx2.fillRect(0, 0, c2.width, c2.height); }
  post({ type: "scene", name: next });
  dirty = true;
};
const env = (): SceneEnv => ({ colors, title: song?.title ?? "", artist: song?.artist ?? "", cover, lowPower });
const step = (dir: 1 | -1) => {
  const i = FULL_SCENES.indexOf(scene);
  setScene(FULL_SCENES[(i + dir + FULL_SCENES.length) % FULL_SCENES.length]);
};

const applyFx = () => {
  const parts: string[] = [];
  if (fx.crt) parts.push("repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 1px,transparent 1px 3px)", "radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.55) 100%)");
  fxLayer.style.background = parts.join(",");
  stage.style.filter = [fx.chroma ? "url(#chroma)" : "", fx.crt ? "contrast(1.15) saturate(1.2)" : ""].join(" ").trim();
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
        if (currentDom) { currentDom.unmount(); currentDom.mount(dom, env()); }
      }
      dirty = true;
      break;
    }
    case "analysis":
      analyses.set(msg.songId, msg.data ? decode(msg.data) : null);
      if (analyses.size > 12) analyses.delete(analyses.keys().next().value!);
      break;
    case "palette":
      colors = msg.colors;
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
      if (msg.autoCycleBars !== undefined) autoCycleBars = msg.autoCycleBars;
      const wanted = mode === "background" ? "aurora" : msg.scene ?? (scene === "aurora" ? FULL_SCENES[0] : scene);
      if (wanted !== scene || prevMode !== mode) { resize(); setScene(wanted); }
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
  if (mode !== "full") return;
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
});

// ---------------------------------------------------------------- frames
const position = () => basePos + (playing ? (Date.now() - baseAt) / 1000 : 0);
let last = performance.now();
let tAcc = 0;
let lastCycleBar = -1;
let lastChaosBar = -1;
const frameTimes: number[] = [];
let lastReport = performance.now();

const drawGl = (s: ReturnType<typeof sample>, t: number) => {
  if (!gl || !tri) return;
  const prog = programs.get(scene);
  if (!prog) return;
  const target3 = (k: SceneName) => k === "milk";
  if (target3(scene) && !feedback) {
    const fw = Math.max(1, Math.round(W * 0.6)), fh = Math.max(1, Math.round(H * 0.6));
    feedback = [target(gl, fw, fh), target(gl, fw, fh)];
  }
  gl.useProgram(prog);
  gl.bindVertexArray(tri);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
  shownColors = shownColors.map((c, i) => lerp(c, hexToVec(colors[i]), 0.04)) as typeof shownColors;
  const set = (w: number, h: number) => {
    gl.uniform2f(u("R"), w, h);
    gl.uniform1f(u("T"), t);
    gl.uniform1f(u("E"), s.energy);
    gl.uniform1f(u("B"), s.bass);
    gl.uniform1f(u("LM"), s.lowmid);
    gl.uniform1f(u("M"), s.mid);
    gl.uniform1f(u("H"), s.high);
    gl.uniform1f(u("BEAT"), s.beat);
    gl.uniform1f(u("BAR"), s.bar);
    gl.uniform1f(u("ON"), s.onset);
    gl.uniform1f(u("PIX"), fx.pixel ? 6 : 0);
    gl.uniform1f(u("DITHER"), fx.dither ? 1 : 0);
    gl.uniform3fv(u("C1"), shownColors[0]);
    gl.uniform3fv(u("C2"), shownColors[1]);
    gl.uniform3fv(u("C3"), shownColors[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverForGl && coverTex ? coverTex : null);
    gl.uniform1i(u("COVER"), 0);
  };
  if (feedback) {
    const [a, b] = feedback;
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
    gl.viewport(0, 0, b.w, b.h);
    set(b.w, b.h);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.uniform1i(u("PREV"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, b.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, b.w, b.h, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    feedback = [b, a];
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    set(W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
};

const loop = (now: number) => {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused || document.hidden) return;
  if (reduceMotion && !dirty) return;
  dirty = false;
  const t0 = performance.now();
  tAcc += reduceMotion ? 0 : dt;
  const d = song ? analyses.get(song.id) ?? null : null;
  const raw = sample(d, position(), playing);
  const s = reduceMotion ? { ...raw, beat: 0, onset: 0, energy: 0.5, bass: 0.4 } : smoother.step(raw, dt);
  if (mode === "full" && !reduceMotion) {
    const bar = Math.floor(s.bar);
    if (chaos && bar !== lastChaosBar) {
      lastChaosBar = bar;
      if (bar % 4 === 0) step(1);
      if (Math.random() < 0.5) { fx = { crt: Math.random() < 0.5, chroma: Math.random() < 0.5, pixel: Math.random() < 0.25, dither: Math.random() < 0.3 }; applyFx(); }
    } else if (!chaos && autoCycleBars > 0 && s.real) {
      const cyc = Math.floor(bar / autoCycleBars);
      if (lastCycleBar >= 0 && cyc !== lastCycleBar) step(1);
      lastCycleBar = cyc;
    }
    if (chaos && s.beat > 0.95 && Math.random() < 0.15) stage.style.filter = `invert(1) ${fx.chroma ? "url(#chroma)" : ""}`;
    else if (chaos && s.beat < 0.5) applyFxFilterOnly();
  }
  if (isGl(scene)) drawGl(s, tAcc);
  else if (current2d && ctx2) current2d.frame(ctx2, c2.width, c2.height, dt, tAcc, s, env());
  else if (currentDom) currentDom.frame(dt, tAcc, s, env(), innerWidth, innerHeight);
  const ft = performance.now() - t0;
  frameTimes.push(dt * 1000, ft);
  if (now - lastReport > 2000 && frameTimes.length > 20) {
    const intervals = frameTimes.filter((_, i) => i % 2 === 0).sort((a, b) => a - b);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const p95 = intervals[Math.floor(intervals.length * 0.95)];
    const dropped = intervals.reduce((n, v) => n + Math.max(0, Math.round(v / 16.67) - 1), 0);
    post({ type: "frames", avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(p95 * 10) / 10, fps: Math.round(1000 / avg), dropped, scene });
    frameTimes.length = 0;
    lastReport = now;
  }
};
const applyFxFilterOnly = () => {
  stage.style.filter = [fx.chroma ? "url(#chroma)" : "", fx.crt ? "contrast(1.15) saturate(1.2)" : ""].join(" ").trim();
};

resize();
setScene("aurora");
requestAnimationFrame(loop);
document.addEventListener("visibilitychange", () => { last = performance.now(); dirty = true; });
post({ type: "ready" });
