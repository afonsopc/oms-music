/** As mensagens entre a app e o motor (/viz/). Partilhado pelos dois lados. */

export type SceneName =
  | "aurora"
  | "milk"
  | "kaleido"
  | "tunnel"
  | "chrome"
  | "plasma"
  | "pipes"
  | "text3d"
  | "mystify"
  | "starfield"
  | "scope"
  | "desktop"
  | "synthwave"
  | "liquid"
  | "voxel"
  | "galaxy"
  | "vhs"
  | "datamosh"
  | "ink"
  | "film"
  | "matrix"
  | "vector"
  | "pixel8";

/** As cenas do ecrã inteiro, pela ordem em que se percorrem. */
export const FULL_SCENES: SceneName[] = [
  "milk", "text3d", "chrome", "tunnel", "kaleido", "pipes", "mystify", "starfield", "scope", "plasma", "desktop",
  "synthwave", "liquid", "voxel", "galaxy", "vhs", "datamosh", "ink", "film", "matrix", "vector", "pixel8",
];

/**
 * As famílias, para escolher "pelo estilo da música": calmo (fado,
 * acústico), electrónico, caos (hardstyle, hyperpop, glitch) e o computador
 * retro. Uma cena pode estar em mais de uma.
 */
export type SceneFamily = "calm" | "electronic" | "chaos" | "retro";
export const SCENE_FAMILIES: Record<SceneFamily, SceneName[]> = {
  calm: ["ink", "film", "kaleido", "plasma", "liquid", "galaxy", "milk"],
  electronic: ["synthwave", "tunnel", "voxel", "galaxy", "milk", "chrome", "liquid", "kaleido"],
  chaos: ["datamosh", "vhs", "desktop", "pixel8", "matrix", "text3d", "chrome", "tunnel", "milk"],
  retro: ["pipes", "mystify", "starfield", "scope", "vector", "pixel8", "matrix", "text3d", "desktop"],
};

export type SceneSelection = "random" | "style";

export interface VizSong {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  /** Géneros/etiquetas da música (song.tags), para a escolha pelo estilo. */
  tags?: string[];
  bpm?: number | null;
}

export interface VizAnalysis {
  v: number;
  fps: number;
  duration: number;
  bpm: number | null;
  beats: number[];
  onsets: number[];
  env: string;
  bands: string[];
}

export interface VizFx {
  crt: boolean;
  chroma: boolean;
  pixel: boolean;
  dither: boolean;
}

export type ToViz =
  | { type: "state"; song: VizSong | null; playing: boolean; position: number; at: number }
  | { type: "analysis"; songId: string; data: VizAnalysis | null }
  | { type: "palette"; colors: [string, string, string] }
  | {
      type: "config";
      mode: "background" | "full";
      scene?: SceneName;
      chaos?: boolean;
      fx?: Partial<VizFx>;
      reduceMotion?: boolean;
      lowPower?: boolean;
      paused?: boolean;
      autoCycleBars?: number;
      selection?: SceneSelection;
      favorites?: SceneName[];
      banned?: SceneName[];
      /** Mudar de cena quando muda a música. */
      cycleOnTrack?: boolean;
    }
  | { type: "next"; dir: 1 | -1 };

export type FromViz =
  | { type: "ready" }
  | { type: "scene"; name: SceneName }
  | { type: "frames"; avgMs: number; p95Ms: number; fps: number; dropped: number; scene: SceneName };
