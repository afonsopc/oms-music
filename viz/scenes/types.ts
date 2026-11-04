import type { Signal } from "../signal";

export interface SceneEnv {
  colors: [string, string, string];
  title: string;
  artist: string;
  cover: HTMLImageElement | null;
  lowPower: boolean;
  /** A linha da letra que está a tocar ("" sem letra). */
  lyric?: string;
}

export interface Canvas2DScene {
  kind: "2d";
  frame(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, t: number, s: Signal, env: SceneEnv): void;
  reset?(): void;
}

export interface DomScene {
  kind: "dom";
  mount(host: HTMLElement, env: SceneEnv): void;
  frame(dt: number, t: number, s: Signal, env: SceneEnv, w: number, h: number): void;
  unmount(): void;
}
