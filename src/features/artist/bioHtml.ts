/**
 * `bio_html` -> paragraphs of plain text (FR-42).
 *
 * The backend sanitizes the bio down to a narrow allowlist (a/i/em/strong/
 * p/br) before it ever reaches a client, but React Native has no HTML
 * renderer and pulling in a WebView for two paragraphs of Last.fm prose is
 * not worth it. Paragraph and line breaks become list entries, every other
 * tag is dropped, and the handful of entities the shim emits are decoded.
 * Pure: unit-tested.
 */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code);
      return Number.isFinite(point) && point > 0 && point < 0x110000
        ? String.fromCodePoint(point)
        : "";
    });

/** Ordered, non-empty paragraphs. Returns [] for null/blank input. */
export const htmlToParagraphs = (html: string | null | undefined): string[] => {
  if (!html) return [];
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*p[^>]*>/gi, "");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
};
