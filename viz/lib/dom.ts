/**
 * Cenas em DOM (CSS 3D, texto, janelas): `mount` põe os elementos no
 * `host`, `frame` só mexe em transformações e opacidades (nada de criar
 * elementos por frame), `unmount` tira tudo. Numa música nova o motor
 * desmonta e volta a montar.
 */
import type { SceneEnv, SceneInstance, SceneMeta, SceneModule, Signal } from "./scene";

export interface Dom {
  mount(host: HTMLElement, env: SceneEnv): void;
  frame(dt: number, t: number, s: Signal, env: SceneEnv, w: number, h: number): void;
  unmount(): void;
}

export const domScene = (meta: Omit<SceneMeta, "layer">, factory: () => Dom): SceneModule => ({
  meta: { ...meta, layer: "dom" },
  create(): SceneInstance {
    let root: HTMLElement | null = null;
    let env: SceneEnv | null = null;
    let sc: Dom | null = null;
    return {
      init(host) {
        root = host.root;
        env = host.env;
        sc = factory();
        sc.mount(root, env);
      },
      frame(t, s, f) { sc?.frame(f.dt, t, s, env!, f.w, f.h); },
      song() { if (sc && root && env) { sc.unmount(); sc.mount(root, env); } },
      dispose() { sc?.unmount(); sc = null; root = null; },
    };
  },
});
