/**
 * Cenas em Canvas 2D: uma fábrica que devolve `frame(ctx, w, h, dt, t, s, env)`.
 * O motor pinta o canvas de preto ao entrar na cena; o rasto (fillRect
 * translúcido) fica por conta da cena. `reset` é chamado quando o tamanho muda.
 *
 *   export default canvasScene({ id: "stars", ... }, () => {
 *     const pts = new Float32Array(900 * 3);          // alocar aqui, não no frame
 *     return { frame(ctx, w, h, dt, t, s, env) { ... } };
 *   });
 */
import type { SceneEnv, SceneInstance, SceneMeta, SceneModule, Signal } from "./scene";

export interface Canvas2D {
  frame(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, t: number, s: Signal, env: SceneEnv): void;
  reset?(): void;
  dispose?(): void;
}

export const canvasScene = (meta: Omit<SceneMeta, "layer">, factory: () => Canvas2D): SceneModule => ({
  meta: { ...meta, layer: "2d" },
  create(): SceneInstance {
    let ctx: CanvasRenderingContext2D | null = null;
    let env: SceneEnv | null = null;
    let sc: Canvas2D | null = null;
    return {
      init(host) {
        ctx = host.ctx;
        env = host.env;
        if (!ctx) throw new Error("sem Canvas 2D");
        sc = factory();
      },
      resize() { sc?.reset?.(); },
      frame(t, s, f) { if (ctx && sc) sc.frame(ctx, f.w, f.h, f.dt, t, s, env!); },
      dispose() { sc?.dispose?.(); sc = null; ctx = null; },
    };
  },
});
