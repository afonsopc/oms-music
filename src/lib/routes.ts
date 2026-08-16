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
 *
 * Os pathnames sao NUS - sem `(main)`, sem `(tabs)`, sem grupo de tab - de
 * proposito. Desde 2026-08-15 cada tab tem a sua stack e as mesmas rotas
 * existem tres vezes, uma por grupo; o expo-router escolhe a copia que esta na
 * tab focada comparando os segmentos de grupo da posicao actual
 * (getRouteConfigSorter). Prefixar com `(home)` mandava toda a navegacao para
 * o Inicio, viesse ela de onde viesse.
 */
import type { Href } from "expo-router";
import { primaryArtistSegment } from "@/domain/format";
import type { Song } from "@/domain/song";

/** The "not set" segment the album/artist screens read as unknown. */
const NONE = "null";

/** `slugOrName` may be an Artist.slug or a raw display name. */
export const artistRoute = (slugOrName: string | null | undefined): Href => ({
  pathname: "/artist/[artist]",
  params: { artist: slugOrName || NONE },
});

export const artistRadioRoute = (slugOrName: string | null | undefined): Href => ({
  pathname: "/radio/artist/[artist]",
  params: { artist: slugOrName || NONE },
});

export const songRadioRoute = (songId: number): Href => ({
  pathname: "/radio/song/[id]",
  params: { id: songId },
});

export const playlistRoute = (playlistId: number): Href => ({
  pathname: "/playlist/[id]",
  params: { id: playlistId },
});

/**
 * Uma conversa do assistente, empurrada por cima da tab Assistente (ou da
 * tab onde o utilizador estiver). "new" abre um chat em branco; o id a serio
 * so nasce no servidor com a primeira mensagem.
 */
export const assistantChatRoute = (chatId: number | "new"): Href => ({
  pathname: "/assistant/[chatId]",
  params: { chatId },
});

/** Mix slugs contain ":" and MUST reach the router unencoded. */
export const mixRoute = (slug: string): Href => ({
  pathname: "/mix/[slug]",
  params: { slug },
});

export const profileRoute = (idOrHandle: string): Href => ({
  pathname: "/profile/[idOrHandle]",
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
  pathname: "/album/[artist]/[album]",
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
