/**
 * Palavra a palavra (2026-11-04): o servidor manda, para cada linha da letra
 * sincronizada, o tempo de cada palavra tal como se ouve. As linhas casam
 * pela marca de tempo (como a tradução), com folga de 60 ms para os
 * arredondamentos. Puro, testado em bun.
 */
import type { LrcLine, LyricsWordLine } from "@/domain/lyrics";

/** A tween da linha activa demora ~220 ms: a linha acende um pouco antes. */
export const LINE_LEAD_S = 0.15;

const MATCH_SLACK_S = 0.06;

/**
 * As palavras de cada linha parseada (null onde não há, e nas linhas em que
 * o alinhador não confia: aí acende a linha inteira, nunca palavras no
 * sítio errado).
 */
export const wordsForLines = (
  lines: readonly LrcLine[],
  words: readonly LyricsWordLine[] | null | undefined,
): (LyricsWordLine["w"] | null)[] => {
  if (!words || words.length === 0) return lines.map(() => null);
  const sorted = [...words].sort((a, b) => a.t - b.t);
  let cursor = 0;
  return lines.map((line) => {
    if (!line.text) return null;
    while (cursor < sorted.length && sorted[cursor].t < line.time - MATCH_SLACK_S) cursor++;
    const hit = sorted[cursor];
    if (hit && Math.abs(hit.t - line.time) <= MATCH_SLACK_S && hit.w.length > 0) {
      cursor++;
      return hit.low ? null : hit.w;
    }
    return null;
  });
};

/** Quantas palavras da linha já começaram nesta posição (0..n). */
export const wordsSung = (words: LyricsWordLine["w"], position: number): number => {
  let n = 0;
  while (n < words.length && words[n][0] <= position) n++;
  return n;
};
