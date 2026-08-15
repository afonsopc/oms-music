/**
 * The one artwork component (FR-21). Every consumer renders artwork through
 * this so missing art looks identical everywhere: the chain always ends at
 * the ONE shared placeholder photo, never an icon or letter tile (initials
 * discs are produced only by `artistImageSource` for pictureless artists in
 * grids, and are rendered here for that case alone).
 *
 * Resolution: local downloaded artwork (contracts/localSource - by song id
 * when one is given, otherwise by the fs node id itself, which is all the
 * album/artist/rail rows carry) > explicit external URL > fs node via
 * `imageUrl()` with the `?token=` convention > placeholder. While offline,
 * doomed network loads are skipped straight to the placeholder. Network
 * sources are cached by fs node id (`cacheKey`), never by URL.
 */
import React, { useState } from "react";
import { Platform, type StyleProp } from "react-native";
import { Image, type ImageStyle } from "expo-image";
import { InitialsAvatar } from "./InitialsAvatar";
import { LikedArtwork } from "./LikedArtwork";
import { imageUrl } from "@/api/mediaUrl";
import { getLocalFileIndex } from "@/contracts/localSource";
import { isOfflineNow } from "@/contracts/offlineFallback";
import type { ArtworkSource } from "@/domain/artwork";
import type { FsNodeId } from "@/domain/ids";
import { toSongKey } from "@/domain/ids";
import { PLACEHOLDER_ARTWORK } from "@/theme/placeholder";
import { RADIUS } from "@/theme/tokens";

export type ArtworkShape = "rounded" | "circle" | "square";

export interface ArtworkImageProps {
  /** Preferred input: a domain artwork chain result. */
  source?: ArtworkSource | null;
  /** Convenience inputs when no chain result is at hand. */
  nodeId?: FsNodeId | null;
  uri?: string | null;
  /** Enables the offline/downloaded artwork lookup for this song. */
  songId?: number | string | null;
  /** Square edge in dp. Ignored when `style` provides dimensions. */
  size?: number;
  shape?: ArtworkShape;
  borderRadius?: number;
  style?: StyleProp<ImageStyle>;
  /** Pass the list identity in recycled rows (FlatList). */
  recyclingKey?: string | null;
  contentFit?: "cover" | "contain";
  transitionMs?: number;
  /** Desfoque em px (fundo imersivo do player). Passa ao expo-image. */
  blurRadius?: number;
}

interface ResolvedArtwork {
  kind: "network" | "local" | "placeholder" | "initials" | "likedHeart";
  uri?: string;
  cacheKey?: string;
  name?: string;
}

const resolveArtwork = (
  source: ArtworkSource | null | undefined,
  nodeId: FsNodeId | null | undefined,
  uri: string | null | undefined,
  songId: number | string | null | undefined,
): ResolvedArtwork => {
  if (source?.kind === "likedHeart") return { kind: "likedHeart" };
  if (source?.kind === "initials") return { kind: "initials", name: source.name };

  // Local downloaded artwork wins: works offline and skips the network.
  if (songId != null && songId !== "") {
    const numeric = typeof songId === "number" ? songId : Number(songId);
    if (Number.isFinite(numeric)) {
      const local = getLocalFileIndex().get(toSongKey(numeric), "artwork");
      if (local) return { kind: "local", uri: local };
    }
  }

  const externalUrl = source?.kind === "external" ? source.url : (uri ?? null);
  const node = source?.kind === "node" ? source.nodeId : (nodeId ?? null);

  // Same win for artwork quoted as a bare fs node: album tiles, the artist
  // album grid, the home rails and the library rows never carry a song id,
  // and downloaded art must still render in airplane mode (FR-91).
  if (node) {
    const localNode = getLocalFileIndex().getArtworkByNodeId(node);
    if (localNode) return { kind: "local", uri: localNode };
  }

  if (isOfflineNow()) return { kind: "placeholder" };
  if (externalUrl) return { kind: "network", uri: externalUrl };
  if (node) {
    // cacheKey is NATIVE-only on purpose: on web it makes expo-image fetch
    // the bytes itself, and that fetch dies on CORS at the storage redirect
    // (every tile fell to the placeholder photo). The plain <img> path has
    // no CORS to clear, and on the Tauri desktop shell the caching layer is
    // the browser's own HTTP cache plus the omscache:// protocol for pinned
    // art (getArtworkByNodeId, already tried above) - not expo-image. Do NOT
    // "fix" this by enabling cacheKey on web.
    //
    // The key is the raw MEDIA ID, and that is a contract, not a detail:
    // api/artworkPrefetch re-keys every warmed cover under exactly this id
    // (expo-image otherwise files prefetched bytes under the URL, which
    // nothing reads and which a token rotation invalidates anyway). If this
    // line ever stops passing `node`, the whole warm sweep silently stops
    // producing hits - which is precisely the bug it was written to fix.
    return {
      kind: "network",
      uri: imageUrl(node),
      cacheKey: Platform.OS === "web" ? undefined : node,
    };
  }
  return { kind: "placeholder" };
};

export const ArtworkImage = ({
  source,
  nodeId,
  uri,
  songId,
  size = 40,
  shape = "rounded",
  borderRadius,
  style,
  recyclingKey,
  contentFit = "cover",
  transitionMs = 120,
  blurRadius,
}: ArtworkImageProps) => {
  const resolved = resolveArtwork(source, nodeId, uri, songId);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const radius =
    shape === "circle" ? size / 2 : shape === "square" ? 0 : (borderRadius ?? RADIUS);

  if (resolved.kind === "likedHeart") {
    return <LikedArtwork size={size} borderRadius={radius} style={style as StyleProp<never>} />;
  }
  if (resolved.kind === "initials") {
    return (
      <InitialsAvatar
        name={resolved.name ?? "?"}
        size={size}
        style={style as StyleProp<never>}
      />
    );
  }

  const failed = resolved.uri != null && failedUri === resolved.uri;
  const imageSource =
    resolved.kind === "placeholder" || failed || !resolved.uri
      ? PLACEHOLDER_ARTWORK
      : { uri: resolved.uri, cacheKey: resolved.cacheKey };

  // Web: transition 0, always. expo-image cannot tell a browser-cache hit
  // from a fresh fetch, and the crossfade ran on BOTH - so even an
  // instantly-available image visibly "popped in" from the placeholder on
  // every mount (avatars, tiles). With the backend now sending Cache-Control
  // on the media/picture redirects, cached loads complete immediately and
  // the placeholder never paints; uncached ones swap in without the fade.
  // Native keeps the crossfade: its disk cache decodes off-frame anyway.
  const transition = Platform.OS === "web" ? 0 : transitionMs;

  return (
    <Image
      source={imageSource}
      placeholder={PLACEHOLDER_ARTWORK}
      placeholderContentFit={contentFit}
      contentFit={contentFit}
      transition={transition}
      blurRadius={blurRadius}
      recyclingKey={recyclingKey ?? undefined}
      onError={() => {
        if (resolved.uri) setFailedUri(resolved.uri);
      }}
      style={[{ width: size, height: size, borderRadius: radius }, style]}
      accessible={false}
    />
  );
};

/**
 * Concrete display URI for an artwork chain result (accent extraction,
 * hero backdrops). Returns null for placeholder/initials/likedHeart.
 */
export const artworkSourceUri = (source: ArtworkSource | null | undefined): string | null => {
  if (!source) return null;
  if (source.kind === "external") return source.url;
  if (source.kind === "node") return imageUrl(source.nodeId);
  return null;
};
