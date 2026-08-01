/**
 * Lyrics translation alignment (FR-79), pure half. Ported from the web
 * LyricsView:
 *
 *  - Synced alignment: the backend keeps LRC timestamps and line counts
 *    identical to the source, so translated lines align one-to-one by the
 *    timestamp string `time.toFixed(2)`.
 *  - Plain alignment: by line index (both sides split on /\r?\n/).
 *  - Identical-line suppression: a translation equal to the original text
 *    (instrumental breaks, vocalizations, lines already in the target
 *    language) adds noise without information and is dropped.
 *
 * Target persistence (kv) lives in features/lyrics/targetStore.ts so this
 * module stays pure and bun-testable.
 */
import { parseLrc } from "./lrc";
import {
  LYRICS_TRANSLATION_TARGETS,
  type LrcLine,
  type LyricsTranslationTarget,
} from "@/domain/lyrics";

/** Native names, so the list reads correctly whatever the UI locale is. */
export const TRANSLATION_TARGET_OPTIONS: readonly {
  code: LyricsTranslationTarget;
  label: string;
}[] = [
  { code: "pt", label: "Português" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "lv", label: "Latviešu" },
];

export const isTranslationTarget = (value: unknown): value is LyricsTranslationTarget =>
  typeof value === "string" &&
  (LYRICS_TRANSLATION_TARGETS as readonly string[]).includes(value);

/** Map keyed by `time.toFixed(2)` from a translated LRC block. */
export const buildSyncedTranslationMap = (
  translatedSynced: string | null | undefined,
): Map<string, string> | null => {
  if (!translatedSynced) return null;
  const map = new Map<string, string>();
  for (const line of parseLrc(translatedSynced)) {
    map.set(line.time.toFixed(2), line.text);
  }
  return map;
};

/**
 * Translation for a synced line, or null when there is none or it is
 * identical to the original.
 */
export const syncedTranslationFor = (
  map: Map<string, string> | null,
  line: LrcLine,
): string | null => {
  if (!map) return null;
  const text = map.get(line.time.toFixed(2));
  return text && text !== line.text ? text : null;
};

export const splitPlainLines = (plain: string): string[] => plain.split(/\r?\n/);

/**
 * Translation for a plain line by index, or null when missing or identical
 * to the original.
 */
export const plainTranslationFor = (
  translatedLines: readonly string[] | null,
  index: number,
  original: string,
): string | null => {
  if (!translatedLines) return null;
  const text = translatedLines[index];
  return text && text !== original ? text : null;
};
