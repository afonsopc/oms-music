/**
 * The ONE place that knows the route tree (FR-20/43/44/121). Every in-app
 * destination is built here, in expo-router's object form, so typed routes
 * check the pathname and the params at compile time instead of letting a
 * hand-rolled template literal rot when a screen moves.
 *
 * Segments are passed RAW: the object form URL-encodes params itself, so
 * neither these builders nor their callers may pre-encode a name (doing both
 * yields "Rui%2520Veloso", which no lookup resolves). The one exception is
 * `features/shell/deepLinkRoute.ts`, which still builds plain strings because
 * `+native-intent` hands the router a path rather than an Href.
 *
 * A missing artist/album keeps the literal "null" segment: the album screen
 * maps it to `exact_search[album]="\b"` / no context artist.
 */
import type { Href } from "expo-router";
import { primaryArtistSegment } from "@/domain/format";
import type { Song } from "@/domain/song";

/** The "not set" segment the album/artist screens read as unknown. */
const NONE = "null";

/** `slugOrName` may be an Artist.slug or a raw display name. */
export const artistRoute = (slugOrName: string | null | undefined): Href => ({
  pathname: "/(main)/artist/[artist]",
  params: { artist: slugOrName || NONE },
});

export const artistRadioRoute = (slugOrName: string | null | undefined): Href => ({
  pathname: "/(main)/radio/artist/[artist]",
  params: { artist: slugOrName || NONE },
});

export const songRadioRoute = (songId: number): Href => ({
  pathname: "/(main)/radio/song/[id]",
  params: { id: songId },
});

export const playlistRoute = (playlistId: number): Href => ({
  pathname: "/(main)/playlist/[id]",
  params: { id: playlistId },
});

/** Mix slugs contain ":" and MUST reach the router unencoded. */
export const mixRoute = (slug: string): Href => ({
  pathname: "/(main)/mix/[slug]",
  params: { slug },
});

export const profileRoute = (idOrHandle: string): Href => ({
  pathname: "/(main)/profile/[idOrHandle]",
  params: { idOrHandle },
});

/**
 * Album route. `highlight` carries the deep-link song title the album screen
 * scrolls to (FR-44) and rides along as a query param.
 */
export const albumRoute = (
  artistSlugOrName: string | null | undefined,
  album: string | null | undefined,
  highlight?: string | null,
): Href => ({
  pathname: "/(main)/album/[artist]/[album]",
  params: {
    artist: artistSlugOrName || NONE,
    album: album || NONE,
    ...(highlight ? { highlight } : {}),
  },
});

/** The song's album page. */
export const songAlbumRoute = (song: Song): Href =>
  albumRoute(primaryArtistSegment(song), song.album);

/** The same page, scrolled to the song itself - the web's `#<title>` hash (FR-44). */
export const songHighlightRoute = (song: Song): Href =>
  albumRoute(primaryArtistSegment(song), song.album, song.title);

/** The song's primary artist page. */
export const songArtistRoute = (song: Song): Href => artistRoute(primaryArtistSegment(song));
