/**
 * Spotify error classification (FR-104), pure. The backend answers routine
 * Spotify problems with bare-string 400 bodies; classifying them keeps a
 * "connect your account" case out of the generic error UI:
 *
 *   "Connect Spotify first."               -> connect banner
 *   "... needs to be relinked."            -> relink banner
 *   "Spotify upstream error"               -> upstream banner with Retry
 *   network / 0 / 502 / 503 / 504 / timeout -> upstream banner with Retry
 *
 * Anything else returns null and the caller shows its normal error copy.
 */

export type SpotifyIssueKind = "connect" | "relink" | "upstream";

export interface SpotifyIssue {
  kind: SpotifyIssueKind;
  /** Raw server text, shown verbatim under the upstream banner. */
  raw: string;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export const classifySpotifyError = (error: unknown): SpotifyIssue | null => {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { body?: unknown; message?: unknown; status?: unknown };
  const bodyText = textOf(candidate.body);
  const message = textOf(candidate.message);
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  const haystack = `${bodyText} ${message}`;

  if (/connect\s+spotify\s+first/i.test(haystack)) {
    return { kind: "connect", raw: bodyText || message };
  }
  if (/needs\s+to\s+be\s+relinked|relink\s+spotify/i.test(haystack)) {
    return { kind: "relink", raw: bodyText || message };
  }
  if (/spotify\s+upstream\s+error/i.test(haystack)) {
    return { kind: "upstream", raw: bodyText || message };
  }
  if (
    status === 0 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /timeout|timed\s+out|network\s+error|abort/i.test(haystack)
  ) {
    return { kind: "upstream", raw: bodyText || message || `HTTP ${status}` };
  }
  return null;
};

/** i18n key pairs per issue kind (title + description). */
export const SPOTIFY_ISSUE_KEYS: Record<SpotifyIssueKind, { title: string; description: string }> = {
  connect: {
    title: "components.music.Settings.ArtistImport.spotifyConnectTitle",
    description: "components.music.Settings.ArtistImport.spotifyConnectDescription",
  },
  relink: {
    title: "components.music.Settings.ArtistImport.spotifyRelinkTitle",
    description: "components.music.Settings.ArtistImport.spotifyRelinkDescription",
  },
  upstream: {
    title: "components.music.Settings.ArtistImport.spotifyUpstreamTitle",
    description: "components.music.Settings.ArtistImport.spotifyUpstreamDescription",
  },
};
