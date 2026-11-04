/**
 * O motor da Montagem (/montage/). Ver README.md. Os clipes descarregam-se
 * uma vez para a memória (saltar dentro deles é instantâneo), três <video>
 * mudos em rodízio (o que se vê, o seguinte já no sítio e um de reserva) e
 * um shader que desenha o vídeo com os efeitos: clarão, zoom de soco,
 * abanão, cores partidas, negativo e grão. Tudo pela posição da música.
 */
import type { FromMontage, MontageSpec, ToMontage } from "./protocol";
import { buildTimeline, clipTime, rateAt, segmentAt, type Segment } from "./timeline";

// ---------------------------------------------------------------- estado
let playing = false;
let basePos = 0;
let baseAt = Date.now();
let reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let paused = false;
let spec: MontageSpec | null = null;
let analysis: { songId: string; duration: number | null; beats: number[]; onsets: number[]; bpm: number | null; env: Uint8Array; fps: number } | null = null;
let segments: Segment[] = [];
let drops: number[] = [];
const blobs = new Map<number, string>(); // id do clipe -> blob: URL
let loading = 0;

const position = () => basePos + (playing ? (Date.now() - baseAt) / 1000 : 0);

const post = (msg: FromMontage) => {
  const rn = (window as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView;
  if (rn) rn.postMessage(JSON.stringify(msg));
  else if (window.parent !== window) window.parent.postMessage({ __montage: true, ...msg }, location.origin);
};

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// ---------------------------------------------------------------- linha do tempo
const rebuild = () => {
  if (!spec || !spec.clips.length) {
    segments = [];
    drops = [];
    return;
  }
  const a = analysis && analysis.songId === spec.songId ? analysis : null;
  const duration = a?.duration ?? 600;
  const env = a ? Array.from(a.env, (v) => v / 255) : [];
  const t = buildTimeline({
    duration,
    bpm: a?.bpm ?? null,
    beats: a?.beats ?? [],
    onsets: a?.onsets ?? [],
    env,
    fps: a?.fps ?? 25,
    clips: spec.clips.map((c) => ({ duration: c.duration, cuts: c.cuts ?? [] })),
    style: spec.style,
    seed: spec.seed,
  });
  segments = t.segments;
  drops = t.drops;
  for (const s of slots) s.seg = -1;
  status();
};

const status = () =>
  post({ type: "status", clips: spec?.clips.length ?? 0, loaded: blobs.size, segments: segments.length, drops: drops.length });

// Os clipes para a memória, dois de cada vez; os que já cá estão ficam.
const load = async (next: MontageSpec) => {
  const want = new Set(next.clips.map((c) => c.id));
  for (const [id, url] of blobs) {
    if (!want.has(id)) {
      URL.revokeObjectURL(url);
      blobs.delete(id);
    }
  }
  const queue = next.clips.filter((c) => c.url && !blobs.has(c.id));
  const token = ++loading;
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const res = await fetch(c.url as string, { mode: "cors", credentials: "omit" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (token !== loading) return;
        blobs.set(c.id, URL.createObjectURL(blob));
        status();
      } catch {
        // um clipe que não veio: os troços dele usam outro
      }
    }
  };
  await Promise.all([worker(), worker()]);
};

// ---------------------------------------------------------------- vídeos
interface Slot {
  el: HTMLVideoElement;
  seg: number;
  src: string;
}
const mkVideo = (): HTMLVideoElement => {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "");
  v.preload = "auto";
  v.loop = false;
  v.crossOrigin = "anonymous";
  v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(v);
  return v;
};
const slots: Slot[] = [0, 1, 2].map(() => ({ el: mkVideo(), seg: -1, src: "" }));
let current: Slot | null = null;

/** O blob do clipe do troço; se ainda não chegou, outro que já cá esteja (sempre o mesmo para o mesmo troço). */
const srcFor = (seg: Segment, index: number): string | null => {
  if (!spec) return null;
  const clip = spec.clips[seg.clip];
  const own = clip && blobs.get(clip.id);
  if (own) return own;
  const ready = spec.clips.map((c) => blobs.get(c.id)).filter((u): u is string => !!u);
  return ready.length ? ready[index % ready.length] : null;
};

const prepare = (slot: Slot, index: number) => {
  const seg = segments[index];
  const src = seg && srcFor(seg, index);
  if (!seg || !src) return;
  slot.seg = index;
  if (slot.src !== src) {
    slot.src = src;
    slot.el.src = src;
  }
  slot.el.pause();
  const at = Math.min(seg.inAt, Math.max(0, (slot.el.duration || 999) - 0.1));
  if (Math.abs(slot.el.currentTime - at) > 0.03) slot.el.currentTime = at;
};

const step = (t: number) => {
  const index = segmentAt(segments, t);
  if (index < 0) return null;
  const seg = segments[index];
  if (!current || current.seg !== index) {
    const ready = slots.find((s) => s.seg === index);
    const slot = ready ?? slots.find((s) => s !== current) ?? slots[0];
    if (!ready) prepare(slot, index);
    if (current && current !== slot) current.el.pause();
    current = slot;
  }
  // o seguinte já no sítio, noutro vídeo
  const nextIndex = index + 1;
  if (nextIndex < segments.length && !slots.some((s) => s.seg === nextIndex)) {
    const free = slots.find((s) => s !== current && s.seg !== index);
    if (free) prepare(free, nextIndex);
  }
  const el = current.el;
  const s = t - seg.t0;
  const want = clipTime(seg, s);
  if (playing && !paused) {
    el.playbackRate = Math.max(0.25, Math.min(4, rateAt(seg, s)));
    if (el.paused) void el.play().catch(() => undefined);
    if (!el.seeking && Math.abs(el.currentTime - want) > 0.25 && want < (el.duration || 999)) el.currentTime = want;
  } else {
    if (!el.paused) el.pause();
    if (!el.seeking && Math.abs(el.currentTime - want) > 0.05) el.currentTime = Math.min(want, (el.duration || 999) - 0.05);
  }
  return { seg, s, el };
};

// ---------------------------------------------------------------- GPU
const canvas = document.createElement("canvas");
canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block";
document.body.appendChild(canvas);
const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" });

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D V;
uniform vec2 res, vres, shake;
uniform float flash, zoom, rgb, grain, time, invert, fade, has;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec2 cover(vec2 u){
  float sa = res.x/res.y, va = vres.x/max(1.,vres.y);
  vec2 s = sa > va ? vec2(1., va/sa) : vec2(sa/va, 1.);
  return (u-.5)*s+.5;
}
void main(){
  vec2 u = (uv-.5)/(1.+zoom)+.5+shake;
  u = cover(u);
  u.y = 1.-u.y;
  vec2 d = (u-.5)*rgb*.045 + vec2(rgb*.006, 0.);
  vec3 c = vec3(texture(V,u+d).r, texture(V,u).g, texture(V,u-d).b) * has;
  c = mix(c, 1.-c, invert);
  c += flash;
  float n = hash(floor(uv*res*.5) + fract(time*13.)*91.) - .5;
  c += n*grain;
  float v = smoothstep(1.25, .35, length((uv-.5)*vec2(res.x/res.y, 1.))*1.1);
  c *= mix(1., v, .55);
  o = vec4(c*fade, 1.);
}`;

let prog: WebGLProgram | null = null;
let tex: WebGLTexture | null = null;
const U: Record<string, WebGLUniformLocation | null> = {};
if (gl) {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  prog = gl.createProgram()!;
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  gl.useProgram(prog);
  for (const n of ["V", "res", "vres", "shake", "flash", "zoom", "rgb", "grain", "time", "invert", "fade", "has"]) U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
}

let W = 0;
let H = 0;
const resize = () => {
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  W = Math.max(1, Math.round(innerWidth * dpr));
  H = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = W;
  canvas.height = H;
};
addEventListener("resize", resize);
resize();

const GRAIN = { fast: 0.07, slow: 0.11, chaos: 0.1 } as const;
let vres: [number, number] = [16, 9];
let has = 0;
let fade = 0;
let lastFrame = performance.now();
const frameMs: number[] = [];

const beatPulse = (t: number): number => {
  const beats = analysis?.beats;
  if (!beats?.length) return 0;
  let lo = 0;
  let hi = beats.length - 1;
  if (beats[0] > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return Math.exp(-(t - beats[lo]) / 0.15);
};

const frame = () => {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  frameMs.push(now - lastFrame);
  lastFrame = now;
  if (frameMs.length >= 120) {
    const sorted = [...frameMs].sort((a, b) => a - b);
    const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
    post({ type: "frames", fps: Math.round(1000 / avg), p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]) });
    frameMs.length = 0;
  }
  if (!gl || !prog || document.hidden) return;
  const t = position();
  const cur = segments.length && blobs.size ? step(t) : null;
  const target = cur ? 1 : 0;
  fade += (target - fade) * Math.min(1, dt * 4);
  let flash = 0;
  let zoom = 0;
  let rgb = 0;
  let shake: [number, number] = [0, 0];
  let invert = 0;
  const style = spec?.style ?? "fast";
  if (cur) {
    const { seg, s, el } = cur;
    if (el.readyState >= 2 && el.videoWidth > 0) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      vres = [el.videoWidth, el.videoHeight];
      has = 1;
    }
    const calm = reduceMotion ? 0 : 1;
    const len = Math.max(0.05, seg.t1 - seg.t0);
    const beat = playing ? beatPulse(t) : 0;
    flash = seg.fx.flash * Math.exp(-s / 0.08) * calm * 0.85;
    zoom = (seg.fx.zoom * Math.exp(-s / 0.2) + (style === "slow" ? (0.04 * s) / len : beat * 0.018)) * calm;
    rgb = (seg.fx.rgb * Math.exp(-s / 0.3) + (style === "chaos" ? 0.12 + beat * 0.3 : 0)) * calm;
    const amp = seg.fx.shake * Math.exp(-s / 0.25) * 0.014 * calm;
    shake = [Math.sin(t * 91.7) * amp, Math.cos(t * 73.3) * amp];
    invert = seg.fx.invert && s < 0.07 ? calm : 0;
  }
  gl.viewport(0, 0, W, H);
  gl.uniform1i(U.V, 0);
  gl.uniform2f(U.res, W, H);
  gl.uniform2f(U.vres, vres[0], vres[1]);
  gl.uniform2f(U.shake, shake[0], shake[1]);
  gl.uniform1f(U.flash, flash);
  gl.uniform1f(U.zoom, zoom);
  gl.uniform1f(U.rgb, rgb);
  gl.uniform1f(U.grain, reduceMotion ? 0 : GRAIN[style]);
  gl.uniform1f(U.time, t);
  gl.uniform1f(U.invert, invert);
  gl.uniform1f(U.fade, fade);
  gl.uniform1f(U.has, has);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};
requestAnimationFrame(frame);

// ---------------------------------------------------------------- mensagens
const handle = (msg: ToMontage) => {
  switch (msg.type) {
    case "state":
      playing = msg.playing;
      basePos = msg.position;
      baseAt = msg.at;
      if (!playing) for (const s of slots) s.el.pause();
      break;
    case "analysis":
      analysis = msg.data
        ? {
            songId: msg.songId,
            duration: msg.duration ?? msg.data.duration ?? null,
            beats: msg.data.beats.map((ms) => ms / 1000),
            onsets: msg.data.onsets.map((ms) => ms / 1000),
            bpm: msg.data.bpm,
            env: b64(msg.data.env),
            fps: msg.data.fps,
          }
        : { songId: msg.songId, duration: msg.duration, beats: [], onsets: [], bpm: null, env: new Uint8Array(0), fps: 25 };
      rebuild();
      break;
    case "montage": {
      const key = (m: MontageSpec | null) => (m ? `${m.songId}|${m.seed}|${m.style}|${m.clips.map((c) => `${c.id}:${c.url}`).join(",")}` : "");
      if (key(msg.spec) === key(spec)) break;
      spec = msg.spec;
      current = null;
      for (const s of slots) {
        s.seg = -1;
        s.el.pause();
      }
      rebuild();
      if (spec) void load(spec);
      break;
    }
    case "config":
      if (msg.reduceMotion !== undefined) reduceMotion = msg.reduceMotion;
      if (msg.paused !== undefined) paused = msg.paused;
      break;
  }
};

addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const data = e.data as (ToMontage & { __toMontage?: boolean }) | null;
  if (data && data.__toMontage) handle(data);
});
(window as unknown as { __montage: (m: ToMontage) => void }).__montage = handle;
post({ type: "ready" });
