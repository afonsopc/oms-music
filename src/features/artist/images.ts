/**
 * Artist hero image chains (FR-38), pure so they are unit-testable.
 *
 * The domain chains (`artistBannerSource` / `artistImageSource`) cover the
 * Artist resource itself; this file layers the two extra sources the artist
 * screen has that no other surface does: the lazily-populated Deezer picture
 * lookup (`GET /songs/artist_pictures`) and the legacy Last.fm shim's
 * `image_url`. Order matches the web ArtistView exactly.
 */
import { artistBannerSource, artistImageSource, type ArtworkSource } from "@/domain/artwork";
import type { Artist } from "@/domain/artist";

/** The `pictures[]` rows of GET /songs/artist_pictures. */
export interface DeezerPicture {
  picture: string | null;
  picture_small: string | null;
  picture_medium: string | null;
  picture_big: string | null;
  picture_xl: string | null;
}

/** True while the resource already carries a picture worth showing. */
export const hasOwnArtistImage = (artist: Artist | undefined | null): boolean =>
  !!(artist?.image_fs_node_id || artist?.compressed_image_fs_node_id || artist?.picture);

/**
 * Full-bleed hero backdrop URI, or null when there is nothing photographic
 * (the hero then falls back to the avatar layout).
 * `resourceUri` is `artworkSourceUri(artistBannerSource(artist))`, resolved
 * by the caller because it needs the token-bearing media URL builder.
 */
export const heroBackdropUri = (
  resourceUri: string | null,
  picture: DeezerPicture | undefined,
  metadataImageUrl: string | null | undefined,
): string | null =>
  resourceUri ??
  picture?.picture_xl ??
  picture?.picture_big ??
  metadataImageUrl ??
  null;

/** Avatar chain used when no backdrop resolved. Ends at initials (FR-21). */
export const heroAvatarSource = (
  artist: Artist | undefined | null,
  picture: DeezerPicture | undefined,
  metadataImageUrl: string | null | undefined,
  displayName: string,
): ArtworkSource => {
  if (artist) {
    const own = artistImageSource(artist, "sm");
    if (own.kind !== "initials") return own;
  }
  const deezer = picture?.picture_medium ?? picture?.picture ?? null;
  if (deezer) return { kind: "external", url: deezer };
  if (metadataImageUrl) return { kind: "external", url: metadataImageUrl };
  return { kind: "initials", name: displayName };
};

/** Banner chain result for the resource alone (caller turns it into a URI). */
export const artistBannerChain = (artist: Artist | undefined | null): ArtworkSource | null =>
  artist ? artistBannerSource(artist) : null;
