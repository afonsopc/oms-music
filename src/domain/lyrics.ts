import type { UserId } from "./ids";

/** Uma linha da letra com o tempo de cada palavra: [início, fim, palavra]. */
export interface LyricsWordLine {
  t: number;
  w: [number, number, string][];
  /** O alinhador não confia nas palavras desta linha: acende-se a linha inteira. */
  low?: boolean;
}

export interface Lyrics {
  synced: string | null;
  plain: string | null;
  attribution: string | null;
  /** Tempos palavra a palavra, pela voz (2026-11-04); ausente nos servidores antigos. */
  words?: LyricsWordLine[] | null;
  /** O acerto do dono, já aplicado pelo servidor às marcas e às palavras. */
  offset_ms?: number;
  /** Quanto a letra de fora se afastava da voz, e se foi acertada. */
  timing?: { checked: boolean; applied: boolean; error_before_ms?: number; method?: string } | null;
  /** O dono da música pode acertar os tempos. */
  can_adjust?: boolean;
}

export interface LyricsTranslation extends Lyrics {
  target: string;
}

/** text "" renders a placeholder dot (FR-76). */
export interface LrcLine {
  time: number;
  text: string;
}

export interface Job {
  id: string;
  job_type: string;
  payload: unknown;
  status: "pending" | "processing" | "complete" | "failed" | "canceled";
  progress: number | null;
  started_at: string | null;
  finished_at: string | null;
  result: unknown;
  error: string | null;
  creator_id: UserId;
  created_at: string;
  updated_at: string;
}

export const LYRICS_TRANSLATION_TARGETS = ["pt", "en", "es", "fr", "de", "it", "lv"] as const;
export type LyricsTranslationTarget = (typeof LYRICS_TRANSLATION_TARGETS)[number];
