/** As mensagens entre a app e o motor da Montagem (/montage/). Partilhado pelos dois lados. */
import type { VizAnalysis } from "../viz/protocol";

export type MontageStyle = "fast" | "slow" | "chaos";

export interface MontageClip {
  id: number;
  url: string | null;
  duration: number;
  width?: number | null;
  height?: number | null;
  /** Mudanças de cena dentro do clipe, em segundos. */
  cuts?: number[];
}

export interface MontageSpec {
  songId: string;
  clips: MontageClip[];
  seed: number;
  style: MontageStyle;
}

export type ToMontage =
  | { type: "state"; playing: boolean; position: number; at: number }
  | { type: "analysis"; songId: string; duration: number | null; data: VizAnalysis | null }
  | { type: "montage"; spec: MontageSpec | null }
  | { type: "config"; reduceMotion?: boolean; paused?: boolean };

export type FromMontage =
  | { type: "ready" }
  | { type: "status"; clips: number; loaded: number; segments: number; drops: number }
  | { type: "frames"; fps: number; p95Ms: number };
