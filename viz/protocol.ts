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
  | "desktop";

/** As cenas do ecrã inteiro, pela ordem em que se percorrem. */
export const FULL_SCENES: SceneName[] = [
  "milk", "text3d", "chrome", "tunnel", "kaleido", "pipes", "mystify", "starfield", "scope", "plasma", "desktop",
];

export interface VizSong {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
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
    }
  | { type: "next"; dir: 1 | -1 };

export type FromViz =
  | { type: "ready" }
  | { type: "scene"; name: SceneName }
  | { type: "frames"; avgMs: number; p95Ms: number; fps: number; dropped: number; scene: SceneName };
