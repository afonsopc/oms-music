/**
 * O harness dos testes (/viz/?test): `window.__vizTest` corre uma cena frame
 * a frame com a música de teste, mede o tempo de cada frame (com a GPU
 * sincronizada) e confirma que a cena se monta, desenha e se desfaz sem
 * erros. Quem o usa: viz/tools/shots.ts (Playwright).
 */
import type { Engine } from "../main";
import { loadCanned } from "./canned-song";

export interface RunResult {
  id: string;
  ok: boolean;
  errors: string[];
  frames: number;
  /** Tempo do frame (mediana): no WebGL com a GPU sincronizada; no 2D e no DOM, o do processador. */
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Intervalo médio entre frames a correr no rAF (16,7 = 60 fps); apanha o trabalho da GPU no 2D e no DOM. */
  intervalMs: number;
  /** KB de memória JS a mais por frame (só no Chromium com --enable-precise-memory-info; 0 sem medida). */
  heapKbPerFrame: number;
  /** O que ficou depois do dispose (elementos na camada DOM, erros do WebGL). */
  leftovers: string[];
}

export const start = async (e: Engine) => {
  const errors: string[] = [];
  addEventListener("error", (ev) => errors.push(String(ev.error?.stack ?? ev.message)));
  addEventListener("unhandledrejection", (ev) => errors.push(String((ev.reason as Error)?.stack ?? ev.reason)));
  const origError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(" ")); origError(...a); };

  e.lock(true);
  await loadCanned(e, 0, true);
  e.handle({ type: "config", mode: "full", lyrics: "never", cycleOnTrack: false });
  const px = new Uint8Array(4);
  /**
   * Esperar que a GPU acabe, para o tempo contar com ela. Só no WebGL: ler
   * píxeis de um canvas 2D (getImageData) faz o Chrome passá-lo para o
   * processador e tudo fica lento; no 2D e no DOM conta o tempo do frame no
   * processador mais o intervalo entre frames (fpsInterval).
   */
  const sync = () => {
    if (e.current()?.meta.layer === "gl" && e.gl) e.gl.readPixels(0, 0, 1, 1, e.gl.RGBA, e.gl.UNSIGNED_BYTE, px);
  };
  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const BATCH = 12;
  const heap = () => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

  const api = {
    scenes: () => e.scenes.map((s) => ({ ...s.meta, pack: s.pack })),
    /** Correr `frames` frames de `id` a partir de `t0` s da música de teste (a queda é aos 30 s: os 120 frames por omissão passam por ela). Deixa a cena no ecrã. */
    async run(id: string, opts: { frames?: number; t0?: number; dt?: number } = {}): Promise<RunResult> {
      const frames = opts.frames ?? 120, t0 = opts.t0 ?? 28.5, dt = opts.dt ?? 1 / 60;
      errors.length = 0;
      e.broken.delete(id);
      e.manual(true);
      e.clear();
      await e.setScene(id);
      const times: number[] = [];
      const cur = e.current();
      if (!cur || cur.id !== id) errors.push(`não entrou (${e.broken.has(id) ? "falhou ao carregar/iniciar" : "?"})`);
      let h0 = 0, h1 = 0;
      // primeira metade seguida, em lotes de 12 frames com uma só espera pela
      // GPU no fim de cada lote (o tempo por frame = lote / 12; os primeiros 12
      // são aquecimento); a segunda metade no rAF, como na app (o intervalo
      // entre frames, que apanha o trabalho da GPU no 2D e no DOM)
      const gaps: number[] = [];
      if (cur && cur.id === id) {
        const tight = frames >> 1;
        let prev = 0, batchStart = performance.now();
        for (let i = 0; i < frames; i++) {
          if (i === BATCH) h0 = heap();
          if (i === tight) h1 = heap();
          if (i >= tight) {
            const now = await nextFrame();
            if (i > tight + 2) gaps.push(now - prev);
            prev = now;
          }
          const t = t0 + i * dt;
          const s = e.smooth(e.signalAt(t), dt);
          e.drawFrame(dt, t, s);
          if (i < tight && (i + 1) % BATCH === 0) {
            sync();
            const now = performance.now();
            if (i + 1 > BATCH) times.push((now - batchStart) / BATCH);
            batchStart = now;
          }
          if (e.broken.has(id)) break;
        }
      }
      // a mediana dos lotes: não salta com um lote em que a GPU estava ocupada com outra coisa
      const warm = [...times].sort((a, b) => a - b);
      const avg = warm[warm.length >> 1] ?? 0;
      return {
        id,
        ok: errors.length === 0 && !e.broken.has(id) && times.length > 0 && gaps.length > 0,
        errors: [...errors],
        frames,
        avgMs: Math.round(avg * 100) / 100,
        p95Ms: Math.round((warm[Math.floor(warm.length * 0.95)] ?? 0) * 100) / 100,
        maxMs: Math.round((warm[warm.length - 1] ?? 0) * 100) / 100,
        intervalMs: Math.round((gaps.reduce((x, y) => x + y, 0) / Math.max(1, gaps.length)) * 100) / 100,
        heapKbPerFrame: h0 && h1 > h0 ? Math.round(((h1 - h0) / 1024 / Math.max(1, (frames >> 1) - BATCH)) * 100) / 100 : 0,
        leftovers: [],
      };
    },
    /** Desfazer a cena actual e ver o que ficou para trás. */
    dispose(): string[] {
      const out: string[] = [];
      const errs0 = errors.length;
      e.clear();
      if (e.dom.childElementCount) out.push(`${e.dom.childElementCount} elemento(s) na camada DOM depois do dispose`);
      if (e.gl) {
        const err = e.gl.getError();
        if (err !== e.gl.NO_ERROR) out.push(`erro do WebGL 0x${err.toString(16)}`);
      }
      if (errors.length > errs0) out.push(...errors.slice(errs0));
      return out;
    },
    /** Pôr a cena a correr sozinha no relógio do motor (para o vídeo), a partir de `position` s. */
    async live(id: string, position = 27) {
      e.clear();
      e.manual(false);
      await e.setScene(id);
      await loadCanned(e, position, true);
    },
    renderer() {
      const g = e.gl;
      if (!g) return "sem WebGL2";
      const ext = g.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(g.getParameter(g.RENDERER));
    },
  };
  (window as unknown as { __vizTest: typeof api }).__vizTest = api;
  document.documentElement.dataset.vizTest = "ready";
};
