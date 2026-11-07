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
 *    language) adds noise without information and is dropped. "Equal" is
 *    after normalising accents, case, punctuation and spaces: a model asked
 *    to translate a Portuguese song into Portuguese hands it back with a
 *    comma or a "?" more, and that line used to show twice (2026-11-07).
 *  - Same language: a song already sung in the target language gets no
 *    translation at all (translationApplies).
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

/** Sem acentos, maiúsculas, pontuação nem espaços a mais: o que conta para "a mesma linha". */
export const normalizeLyricLine = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const sameLyricLine = (a: string, b: string): boolean =>
  a === b || normalizeLyricLine(a) === normalizeLyricLine(b);

/**
 * Há tradução para mostrar nesta língua? Não quando a música já é cantada
 * nela (a língua vem da letra, "pt", "pt-PT"...; desconhecida conta como
 * outra) nem quando o servidor diz same_language.
 */
export const translationApplies = (
  language: string | null | undefined,
  target: LyricsTranslationTarget,
): boolean => !language || language.trim().toLowerCase().slice(0, 2) !== target;

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
 * the original once normalised.
 */
export const syncedTranslationFor = (
  map: Map<string, string> | null,
  line: LrcLine,
): string | null => {
  if (!map) return null;
  const text = map.get(line.time.toFixed(2));
  return text && !sameLyricLine(text, line.text) ? text : null;
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
  return text && !sameLyricLine(text, original) ? text : null;
};
