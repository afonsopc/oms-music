/**
 * Relevance scoring for library search results (FR-30). The backend matches
 * with a slugified LIKE '%term%' and returns rows alphabetically; where the
 * term sits in the name is the signal that is missing. Ported verbatim from
 * the web frontend/lib/searchRank.ts.
 */

/** Strip accents and case so "Paião" matches "paiao". */
const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 0 when there is no match at all; higher is a better match. */
export const matchScore = (text: string | null | undefined, query: string): number => {
  const haystack = normalize(text ?? "");
  const needle = normalize(query);
  if (!haystack || !needle) return 0;

  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80;
  // A term that opens any word beats one buried mid-word.
  if (new RegExp(`\\b${escapeRegExp(needle)}`).test(haystack)) return 60;
  if (haystack.includes(needle)) return 40;
  return 0;
};

/**
 * Sorts by score, then by name length (a shorter name containing the term is
 * the more specific answer). Stable for equal entries.
 */
export const rankByMatch = <T>(
  items: T[],
  query: string,
  textOf: (item: T) => string | null | undefined,
): T[] => {
  if (!query.trim()) return items;
  return items
    .map((item, index) => {
      const text = textOf(item) ?? "";
      return { item, index, score: matchScore(text, query), length: text.length };
    })
    .sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index)
    .map((entry) => entry.item);
};
