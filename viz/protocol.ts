/** As mensagens entre a app e o motor (/viz/). Partilhado pelos dois lados. */

/**
 * Uma cena é um id (o nome do ficheiro em viz/scenes/<pacote>/<id>.ts),
 * validado contra o índice gerado; a lista vem do motor (mensagem
 * "catalog"), não está escrita aqui.
 */
export type SceneName = string;

/**
 * As famílias, para escolher "pelo estilo da música": calmo (fado,
 * acústico), electrónico, caos (hardstyle, hyperpop, glitch) e o computador
 * retro. Cada cena diz as suas no `meta`.
 */
export type SceneFamily = "calm" | "electronic" | "chaos" | "retro";

/** O que a app precisa de saber de cada cena para a lista de favoritas/banidas. */
export interface VizSceneInfo {
  id: SceneName;
  name: string;
  names?: { en?: string; lv?: string };
  pack: string;
  families: SceneFamily[];
  intensity: number;
  cost: number;
}

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

/**
 * Uma linha da letra: início e fim em s, e as palavras [início, fim, palavra]
 * quando há. `whole`: os tempos das palavras não são de confiança, a linha
 * acende inteira (sem palavras, o motor reparte-as pela linha).
 */
export interface VizLyricLine {
  t: number;
  end: number;
  text: string;
  words?: [number, number, string][];
  whole?: boolean;
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
      /** O atraso da letra deste aparelho (ms, positivo atrasa). */
      lyricsDelayMs?: number;
    }
  | { type: "next"; dir: 1 | -1 };

export type FromViz =
  | { type: "ready" }
  | { type: "scene"; name: SceneName; label?: string }
  | { type: "catalog"; scenes: VizSceneInfo[] }
  | { type: "frames"; avgMs: number; p95Ms: number; fps: number; dropped: number; scene: SceneName };
