/**
 * Artwork source selection chains (pure, zero I/O). Consumers turn a
 * `node` result into a URL with `api/mediaUrl.imageUrl(nodeId)`; a
 * `placeholder` result renders the ONE shared placeholder photo (FR-21),
 * never an icon or letter tile. `initials` is legal ONLY for pictureless
 * artists in card grids.
 */
import type { FsNodeId } from "./ids";
import type { Artist } from "./artist";
import type { Playlist } from "./playlist";
import type { Song } from "./song";
import { isLikedMirror } from "./playlist";

export type ArtworkSource =
  | { kind: "node"; nodeId: FsNodeId }
  | { kind: "external"; url: string }
  | { kind: "placeholder" }
  | { kind: "initials"; name: string }
  | { kind: "likedHeart" };

/** Song artwork: jam presigned url > compressed node > node > placeholder. */
export const songArtworkSource = (
  song: Pick<Song, "artwork_url" | "compressed_artwork_fs_node_id" | "artwork_fs_node_id">,
): ArtworkSource => {
  if (song.artwork_url) return { kind: "external", url: song.artwork_url };
  const node = song.compressed_artwork_fs_node_id ?? song.artwork_fs_node_id;
  if (node) return { kind: "node", nodeId: node };
  return { kind: "placeholder" };
};

/** Playlist artwork: liked mirror draws the purple heart; else node or placeholder. */
export const playlistArtworkSource = (playlist: Playlist): ArtworkSource => {
  if (isLikedMirror(playlist)) return { kind: "likedHeart" };
  if (playlist.artwork_fs_node_id) return { kind: "node", nodeId: playlist.artwork_fs_node_id };
  return { kind: "placeholder" };
};

export type ArtistImageSize = "sm" | "lg";

type ArtistImageCarrier = Pick<
  Artist,
  | "name"
  | "compressed_image_fs_node_id"
  | "image_fs_node_id"
  | "picture"
  | "picture_medium"
  | "picture_big"
  | "picture_xl"
  | "external_image_url"
  | "fallback_artwork_fs_node_id"
> & { gallery_image_urls?: string[] };

/**
 * Artist image chain: compressed upload > upload > Deezer picture by size
 * (sm contexts: picture_medium; hero: picture_xl/picture_big) > picture >
 * gallery[0] > fallback artwork node > external_image_url > initials.
 */
export const artistImageSource = (
  artist: ArtistImageCarrier,
  size: ArtistImageSize = "sm",
): ArtworkSource => {
  if (artist.compressed_image_fs_node_id)
    return { kind: "node", nodeId: artist.compressed_image_fs_node_id };
  if (artist.image_fs_node_id) return { kind: "node", nodeId: artist.image_fs_node_id };
  const deezer =
    size === "sm"
      ? artist.picture_medium
      : (artist.picture_xl ?? artist.picture_big ?? artist.picture_medium);
  if (deezer) return { kind: "external", url: deezer };
  if (artist.picture) return { kind: "external", url: artist.picture };
  const gallery = artist.gallery_image_urls?.[0];
  if (gallery) return { kind: "external", url: gallery };
  if (artist.fallback_artwork_fs_node_id)
    return { kind: "node", nodeId: artist.fallback_artwork_fs_node_id };
  if (artist.external_image_url) return { kind: "external", url: artist.external_image_url };
  return { kind: "initials", name: artist.name };
};

type ArtistBannerCarrier = ArtistImageCarrier &
  Pick<Artist, "compressed_banner_fs_node_id" | "banner_fs_node_id">;

/** Artist banner chain: compressed banner > banner > xl > big > external > image chain. */
export const artistBannerSource = (artist: ArtistBannerCarrier): ArtworkSource => {
  if (artist.compressed_banner_fs_node_id)
    return { kind: "node", nodeId: artist.compressed_banner_fs_node_id };
  if (artist.banner_fs_node_id) return { kind: "node", nodeId: artist.banner_fs_node_id };
  if (artist.picture_xl) return { kind: "external", url: artist.picture_xl };
  if (artist.picture_big) return { kind: "external", url: artist.picture_big };
  if (artist.external_image_url) return { kind: "external", url: artist.external_image_url };
  return artistImageSource(artist, "lg");
};
