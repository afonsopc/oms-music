/**
 * Album tile grid for the artist screen's Discography and "Participates in"
 * sections (FR-40). Album route segments prefer the row's own
 * `artist_slug`, then the page artist's slug, then the URL-encoded name -
 * exactly the web's fallback chain, so tiles opened from a featured artist
 * still land on the right album page.
 */
import React from "react";
import { useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import type { AlbumSummary } from "@/domain/album";
import { artistDisplayName } from "@/domain/album";
import { useT } from "@/i18n";
import { Tile } from "@/ui";
import { albumRoute } from "@/features/artists/routes";

const GUTTER = 8;
const HORIZONTAL_PADDING = 40;

export interface AlbumGridProps {
  albums: AlbumSummary[];
  /** Slug of the artist whose page this is; second in the segment chain. */
  fallbackArtistSegment?: string | null;
  /** Featured grids label the tile with the album's own artist. */
  showAlbumArtistSubtitle?: boolean;
}

const columnsForWidth = (width: number): number =>
  width >= 1024 ? 5 : width >= 768 ? 4 : width >= 520 ? 3 : 2;

export const AlbumGrid = ({
  albums,
  fallbackArtistSegment,
  showAlbumArtistSubtitle = false,
}: AlbumGridProps) => {
  const t = useT();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const columns = columnsForWidth(width);
  const tileWidth = Math.floor((width - HORIZONTAL_PADDING - (columns - 1) * GUTTER) / columns);

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: GUTTER,
        paddingHorizontal: HORIZONTAL_PADDING / 2,
      }}
    >
      {albums.map((album, index) => {
        const albumArtist = artistDisplayName(album.artist);
        const segment = album.artist_slug || fallbackArtistSegment || albumArtist || null;
        return (
          <Tile
            key={`${album.artist_slug ?? albumArtist ?? "unknown"}:${album.name ?? "null"}:${index}`}
            title={album.name ?? t("components.music.ArtistView.unknownAlbum")}
            subtitle={
              showAlbumArtistSubtitle
                ? (albumArtist ?? t("components.music.ArtistView.albumSubtitle"))
                : t("components.music.ArtistView.albumSubtitle")
            }
            artwork={
              album.artwork_fs_node_id
                ? { kind: "node", nodeId: album.artwork_fs_node_id }
                : { kind: "placeholder" }
            }
            width={tileWidth}
            onPress={() => router.push(albumRoute(segment, album.name))}
          />
        );
      })}
    </View>
  );
};
