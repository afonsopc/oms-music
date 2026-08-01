/**
 * Param serialization (FR-3, FR-4). Pure - unit-tested under bun.
 *
 * - Every `null` in outgoing params AND JSON bodies becomes the literal
 *   one-char string "\b" (backspace); the backend converts it to SQL NULL.
 *   Omitting a key means "no filter / unchanged". FormData and raw payloads
 *   are exempt (the client sends them verbatim).
 * - GET query strings use axios-style bracket encoding: `search[title]=x`,
 *   `modifiers[page]=1:100`, arrays as `key[]=a&key[]=b`.
 */

export const NULL_SENTINEL = "\b";

/** Deep-rewrites null -> "\b" in plain objects and arrays. */
export const deepNullToSentinel = (value: unknown): unknown => {
  if (value === null) return NULL_SENTINEL;
  if (Array.isArray(value)) return value.map(deepNullToSentinel);
  if (typeof value === "object" && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = deepNullToSentinel(v);
    }
    return out;
  }
  return value;
};

const encodeComponent = (value: string): string => encodeURIComponent(value);

const scalarToString = (value: unknown): string => {
  if (value === null) return NULL_SENTINEL;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

const appendPairs = (pairs: [string, string][], keyPath: string, value: unknown): void => {
  if (value === undefined) return;
  if (value === null) {
    pairs.push([keyPath, NULL_SENTINEL]);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) appendPairs(pairs, `${keyPath}[]`, entry);
    return;
  }
  if (typeof value === "object" && value.constructor === Object) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendPairs(pairs, `${keyPath}[${k}]`, v);
    }
    return;
  }
  pairs.push([keyPath, scalarToString(value)]);
};

/**
 * Encodes params into a query string (no leading "?"). Bracket characters in
 * key paths stay literal (Rails parses either form; this matches axios).
 */
export const encodeQuery = (params: Record<string, unknown>): string => {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) appendPairs(pairs, key, value);
  return pairs
    .map(([k, v]) => {
      const encodedKey = k
        .split(/([[\]])/)
        .map((part) => (part === "[" || part === "]" ? part : encodeComponent(part)))
        .join("");
      return `${encodedKey}=${encodeComponent(v)}`;
    })
    .join("&");
};

/** Builds the `modifiers[page]` value; pages are 1-based, SIZE capped at 500. */
export const pageModifier = (page: number, size: number): `${number}:${number}` => {
  const clampedSize = Math.max(1, Math.min(500, Math.floor(size)));
  const clampedPage = Math.max(1, Math.floor(page));
  return `${clampedPage}:${clampedSize}`;
};
