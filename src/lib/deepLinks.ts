/**
 * Deep link parser (FR-20, pure). Handles full web URLs
 * (https://omelhorsite.pt/<locale>/music/...) and the omsmusic:// custom
 * scheme. Covers: locale prefix stripping (/en|/pt|/lv), `?id=`/`?slug=`
 * detail params, BOTH `/music/artist/<a>/<al>` and `/music/album/<a>/<al>`
 * album forms, artist segment = slug or URL-encoded name, and the literal
 * "null" album segment (maps to `exact_search[album]="\b"` downstream).
 */

export type DeepLinkTarget =
  | { kind: "home" }
  | { kind: "liked" }
  | { kind: "artists" }
  | { kind: "playlists" }
  | { kind: "search"; query: string | null }
  | { kind: "playlist"; id: number }
  | { kind: "mix"; slug: string }
  | { kind: "radioArtist"; artist: string }
  | { kind: "radioSong"; id: number }
  | { kind: "artist"; artist: string }
  | {
      kind: "album";
      /** Decoded artist segment; null for the literal "null" (unknown). */
      artist: string | null;
      /** Decoded album name; null for the literal "null" (unknown album). */
      album: string | null;
      /** Decoded #hash song-title highlight (FR-44), when present. */
      highlight: string | null;
    }
  | { kind: "settings"; page: "import" | "songs" | "artists" | "playback" | "downloads" };

const LOCALES = new Set(["en", "pt", "lv"]);

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseQuery = (query: string): Map<string, string> => {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : "";
    params.set(safeDecode(key), safeDecode(value.replace(/\+/g, " ")));
  }
  return params;
};

interface ParsedUrl {
  segments: string[];
  params: Map<string, string>;
  hash: string | null;
}

/** Splits any accepted URL into decoded path segments + query + hash. */
const dissect = (url: string): ParsedUrl | null => {
  let rest = url.trim();
  if (!rest) return null;

  const schemeMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    rest = rest.slice(schemeMatch[0].length);
    if (scheme === "http" || scheme === "https") {
      // Drop the host.
      const slash = rest.indexOf("/");
      rest = slash === -1 ? "" : rest.slice(slash);
    }
    // For omsmusic:// the "host" part is already the first path segment.
  }

  let hash: string | null = null;
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) {
    hash = safeDecode(rest.slice(hashIndex + 1)) || null;
    rest = rest.slice(0, hashIndex);
  }

  let query = "";
  const queryIndex = rest.indexOf("?");
  if (queryIndex !== -1) {
    query = rest.slice(queryIndex + 1);
    rest = rest.slice(0, queryIndex);
  }

  const segments = rest
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s);

  // Strip a leading locale prefix.
  if (segments.length > 0 && LOCALES.has(segments[0].toLowerCase())) segments.shift();
  // Strip the "music" section prefix when present.
  if (segments.length > 0 && segments[0].toLowerCase() === "music") segments.shift();

  return { segments, params: parseQuery(query), hash };
};

const nullableSegment = (segment: string): string | null => {
  const decoded = safeDecode(segment);
  return decoded === "null" ? null : decoded;
};

/**
 * Parses a URL into a navigation target. Returns null for URLs that do not
 * belong to the music area (callers ignore them). Missing detail params fall
 * back per the web behavior (playlist -> playlists; mix/radio -> home).
 */
export const parseDeepLink = (url: string): DeepLinkTarget | null => {
  const parsed = dissect(url);
  if (!parsed) return null;
  const { segments, params, hash } = parsed;

  if (segments.length === 0) return { kind: "home" };

  const [head, ...tail] = segments;
  switch (head.toLowerCase()) {
    case "discover":
      return { kind: "home" };
    case "liked":
      return { kind: "liked" };
    case "artists":
      return { kind: "artists" };
    case "playlists":
      return { kind: "playlists" };
    case "search":
      return { kind: "search", query: params.get("query") ?? null };
    case "playlist": {
      const id = Number(params.get("id"));
      return Number.isInteger(id) && id > 0 ? { kind: "playlist", id } : { kind: "playlists" };
    }
    case "mix": {
      const slug = params.get("slug");
      return slug ? { kind: "mix", slug } : { kind: "home" };
    }
    case "radio": {
      const sub = tail[0]?.toLowerCase();
      if (sub === "song") {
        const id = Number(params.get("id"));
        return Number.isInteger(id) && id > 0 ? { kind: "radioSong", id } : { kind: "home" };
      }
      if (sub === "artist") {
        const artist = params.get("artist");
        return artist ? { kind: "radioArtist", artist } : { kind: "home" };
      }
      return { kind: "home" };
    }
    case "artist": {
      if (tail.length === 0) return { kind: "artists" };
      if (tail.length === 1) {
        const artist = nullableSegment(tail[0]);
        // The web redirects /music/artist/null to the artists list.
        return artist ? { kind: "artist", artist } : { kind: "artists" };
      }
      return {
        kind: "album",
        artist: nullableSegment(tail[0]),
        album: nullableSegment(tail[1]),
        highlight: hash,
      };
    }
    case "album": {
      if (tail.length < 2) return { kind: "home" };
      return {
        kind: "album",
        artist: nullableSegment(tail[0]),
        album: nullableSegment(tail[1]),
        highlight: hash,
      };
    }
    case "settings": {
      const page = tail[0]?.toLowerCase();
      if (page === "songs" || page === "artists" || page === "playback" || page === "downloads") {
        return { kind: "settings", page };
      }
      return { kind: "settings", page: "import" };
    }
    default:
      return null;
  }
};
