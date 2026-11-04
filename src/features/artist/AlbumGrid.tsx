/**
 * Album tile grid for the artist screen's Discography and "Participates in"
 * sections (FR-40). Album route segments prefer the row's own
 * `artist_slug`, then the page artist's slug, then the URL-encoded name -
 * exactly the web's fallback chain, so tiles opened from a featured artist
 * still land on the right album page.
 */
import React from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import type { AlbumSummary } from "@/domain/album";
import { artistDisplayName } from "@/domain/album";
import { useT } from "@/i18n";
import { albumRoute } from "@/lib/routes";
import { collectionGridColumns, Tile, useContainerWidth, useDesktopShell } from "@/ui";
import { useGutter } from "@/ui/page";

const GAP = 8;

export interface AlbumGridProps {
  albums: AlbumSummary[];
  /** Slug of the artist whose page this is; second in the segment chain. */
  fallbackArtistSegment?: string | null;
  /** Featured grids label the tile with the album's own artist. */
  showAlbumArtistSubtitle?: boolean;
}

export const AlbumGrid = ({
  albums,
  fallbackArtistSegment,
  showAlbumArtistSubtitle = false,
}: AlbumGridProps) => {
  const t = useT();
  const router = useRouter();
  // Container width (breakpoints.ts): the desktop shell's main pane is what
  // this grid actually fills; on mobile it is the window, as before.
  const width = useContainerWidth();
  const { width: windowWidth } = useWindowDimensions();
  const desktop = useDesktopShell();
  const gutter = useGutter();
  // Os cartões (Tile) têm 12 de padding próprio: o conteúdo começa na margem.
  const edge = Math.max(0, gutter - 12);

  const columns = collectionGridColumns(width);
  const tileWidth = desktop
    ? Math.floor((width - edge * 2 - (columns - 1) * GAP) / columns)
    : // Telemóvel: uma fila que corre de lado, capas grandes (cabem duas e
      // um pedaço da terceira, que diz "há mais para o lado").
      Math.round(Math.min(220, (windowWidth - gutter) / 2.15));

  const tiles = albums.map((album, index) => {
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
              album.artwork_media_id
                ? { kind: "node", nodeId: album.artwork_media_id }
                : { kind: "placeholder" }
            }
            width={tileWidth}
            onPress={() => router.push(albumRoute(segment, album.name))}
          />
        );
      });

  if (!desktop) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: edge }}
      >
        {tiles}
      </ScrollView>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: GAP,
        paddingHorizontal: edge,
      }}
    >
      {tiles}
    </View>
  );
};
