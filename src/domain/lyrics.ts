import type { UserId } from "./ids";

export interface Lyrics {
  synced: string | null;
  plain: string | null;
  attribution: string | null;
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
