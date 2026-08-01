/**
 * Route builders for the WP6 collection surfaces. Segments are always
 * URL-encoded (artist segments may be raw names, album names may contain
 * slashes) and the literal "null" segments are preserved: the album screen
 * maps them to `exact_search[album]="\b"` / no context artist, exactly like
 * `features/shell/deepLinkRoute.ts` does for incoming links (FR-20/43).
 */
const enc = encodeURIComponent;

/** `slugOrName` may be an Artist.slug or a raw display name. */
export const artistRoute = (slugOrName: string): string => `/(main)/artist/${enc(slugOrName)}`;

export const artistRadioRoute = (slugOrName: string): string =>
  `/(main)/radio/artist/${enc(slugOrName)}`;

export const songRadioRoute = (songId: number): string => `/(main)/radio/song/${songId}`;

export const playlistRoute = (playlistId: number): string => `/(main)/playlist/${playlistId}`;

/** Mix slugs contain ":" and MUST be encoded (FR-121). */
export const mixRoute = (slug: string): string => `/(main)/mix/${enc(slug)}`;

/**
 * Album route. A null artist or album becomes the literal "null" segment
 * (unknown artist / unknown album). `highlight` carries the deep-link song
 * title the album screen scrolls to (FR-44).
 */
export const albumRoute = (
  artistSlugOrName: string | null | undefined,
  album: string | null | undefined,
  highlight?: string | null,
): string => {
  const artistSegment = artistSlugOrName ? enc(artistSlugOrName) : "null";
  const albumSegment = album ? enc(album) : "null";
  const query = highlight ? `?highlight=${enc(highlight)}` : "";
  return `/(main)/album/${artistSegment}/${albumSegment}${query}`;
};
