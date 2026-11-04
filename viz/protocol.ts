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
  | "pixel8"
  | "collage";

/** As cenas do ecrã inteiro, pela ordem em que se percorrem. */
export const FULL_SCENES: SceneName[] = [
  "milk", "text3d", "chrome", "tunnel", "kaleido", "pipes", "mystify", "starfield", "scope", "plasma", "desktop",
  "synthwave", "liquid", "voxel", "galaxy", "vhs", "datamosh", "ink", "film", "matrix", "vector", "pixel8",
  "collage",
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
  chaos: ["datamosh", "vhs", "desktop", "pixel8", "matrix", "text3d", "chrome", "tunnel", "milk", "collage"],
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

/** Uma secção da música (Music::AudioAnalysis v2). `big`: queda ou refrão, onde se muda de visual. */
export interface VizSection {
  t: number;
  type: "intro" | "verse" | "build" | "drop" | "chorus" | "high" | "breakdown" | "outro";
  intensity: number;
  group: number;
  big: boolean;
}

/** Uma linha da letra: início e fim em s, e as palavras [início, fim, palavra] quando há. */
export interface VizLyricLine {
  t: number;
  end: number;
  text: string;
  words?: [number, number, string][];
}

export type LyricsMode = "always" | "sometimes" | "never";

export interface VizAnalysis {
  v: number;
  fps: number;
  duration: number;
  bpm: number | null;
  beats: number[];
  onsets: number[];
  env: string;
  bands: string[];
  sections?: VizSection[];
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
  | { type: "lyrics"; songId: string; lines: VizLyricLine[] | null }
  | {
      type: "config";
      mode: "background" | "full";
      scene?: SceneName;
      chaos?: boolean;
      fx?: Partial<VizFx>;
      reduceMotion?: boolean;
      lowPower?: boolean;
      paused?: boolean;
      selection?: SceneSelection;
      favorites?: SceneName[];
      banned?: SceneName[];
      /** Mudar de cena quando muda a música. */
      cycleOnTrack?: boolean;
      lyrics?: LyricsMode;
    }
  | { type: "next"; dir: 1 | -1 };

export type FromViz =
  | { type: "ready" }
  | { type: "scene"; name: SceneName }
  | { type: "frames"; avgMs: number; p95Ms: number; fps: number; dropped: number; scene: SceneName };
