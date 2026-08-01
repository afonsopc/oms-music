/**
 * Home / Discover (FR-23..29), ported from the web `Home` component.
 *
 * Five parallel queries feed the screen; every section collapses silently
 * when its query settles empty (there is no Home empty state). The filter
 * pills are LOCAL state only: switching a pill shows/hides sections and
 * never refetches (FR-23).
 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMixes } from "@/api/queries/mixes";
import { useRecentAlbums, useTopArtists } from "@/api/queries/playEvents";
import { usePlaylists } from "@/api/queries/playlists";
import { useRandomAlbums } from "@/api/queries/songs";
import { artistDisplayName, artistRouteSegment } from "@/domain/album";
import {
  artistImageSource,
  playlistArtworkSource,
  type ArtworkSource,
} from "@/domain/artwork";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { mixDescription, mixStampText, mixTitle } from "@/i18n/mixLabels";
import { albumRoute, artistRoute, mixRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { typeScale } from "@/theme/typography";
import {
  artworkSourceUri,
  FilterPills,
  MixTile,
  Rail,
  Skeleton,
  Tile,
  TileSkeleton,
  TopTileGrid,
  type TopTileItem,
} from "@/ui";
import { useFriendsStripActive, useFriendsStripSlot } from "./friendsSlot";

type HomeFilter = "all" | "playlists" | "albums" | "artists";

const nodeArtwork = (nodeId: string | null | undefined): ArtworkSource =>
  nodeId ? { kind: "node", nodeId } : { kind: "placeholder" };

/**
 * The friends listening strip (FR-29 placement): Home owns WHERE it sits,
 * WP10 owns the content. Nothing renders until the slot is registered and
 * reports live rows.
 */
const FriendsStrip = () => {
  const slot = useFriendsStripSlot();
  const active = useFriendsStripActive(slot);
  if (!slot || !active) return null;
  const Content = slot.Component;
  return <Content />;
};

const RailSkeletons = ({ count = 6 }: { count?: number }) => (
  <>
    {Array.from({ length: count }, (_, i) => (
      <TileSkeleton key={i} />
    ))}
  </>
);

export default function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = useContentBottomPadding();
  const [filter, setFilter] = useState<HomeFilter>("all");

  const recentAlbumsQuery = useRecentAlbums(8);
  const mixesQuery = useMixes();
  const playlistsQuery = usePlaylists({ page: "1:20" });
  const recommendationsQuery = useRandomAlbums(10);
  const topArtistsQuery = useTopArtists("30d", 10);

  const recentAlbums = recentAlbumsQuery.data ?? [];
  const playlists = playlistsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? [];
  const topArtists = topArtistsQuery.data ?? [];
  const mixes = mixesQuery.data ?? [];

  // Top tiles fall back to the first 8 playlists when there is no play
  // history; with neither the whole section is hidden (FR-24).
  const topItems: TopTileItem[] =
    recentAlbums.length > 0
      ? recentAlbums.map((album, i) => ({
          key: `recent-${i}-${album.album ?? "null"}`,
          title: album.album || t("components.music.Home.unknownAlbum"),
          artwork: nodeArtwork(album.artwork_fs_node_id),
          onPress: () =>
            router.push(albumRoute(artistRouteSegment(album.artist), album.album)),
        }))
      : playlists.slice(0, 8).map((playlist) => ({
          key: `playlist-${playlist.id}`,
          title: playlist.name,
          artwork: playlistArtworkSource(playlist),
          onPress: () => router.push(playlistRoute(playlist.id)),
        }));

  const showSection = (kind: "playlists" | "albums" | "artists"): boolean =>
    filter === "all" || filter === kind;

  const pills = [
    { key: "all", label: t("components.music.Home.filterAll") },
    { key: "playlists", label: t("components.music.Home.filterPlaylists") },
    { key: "albums", label: t("components.music.Home.filterAlbums") },
    { key: "artists", label: t("components.music.Home.filterArtists") },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: bottomPadding + 24,
        gap: 28,
      }}
    >
      <Text
        style={[typeScale.sectionHeader, { color: tokens.foreground, paddingHorizontal: 24 }]}
      >
        {t("components.music.Sidebar.discover")}
      </Text>

      <FilterPills
        pills={pills}
        activeKey={filter}
        onChange={(key) => setFilter(key as HomeFilter)}
      />

      {filter === "all" ? (
        recentAlbumsQuery.isLoading ? (
          <View style={{ gap: 8, paddingHorizontal: 24 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} height={64} />
            ))}
          </View>
        ) : topItems.length > 0 ? (
          <TopTileGrid items={topItems} />
        ) : null
      ) : null}

      {filter === "all" ? <FriendsStrip /> : null}

      {filter === "all" && (mixesQuery.isLoading || mixes.length > 0) ? (
        <Rail title={t("components.music.Home.madeForYou")}>
          {mixesQuery.isLoading ? (
            <RailSkeletons />
          ) : (
            mixes.map((mix) => {
              const title = mixTitle(mix, t);
              return (
                <MixTile
                  key={mix.slug}
                  kind={mix.kind}
                  title={title}
                  description={mixDescription(mix, t)}
                  stamp={mixStampText(mix, title)}
                  artworkUri={
                    mix.artist ? artworkSourceUri(artistImageSource(mix.artist, "sm")) : null
                  }
                  onPress={() => router.push(mixRoute(mix.slug))}
                />
              );
            })
          )}
        </Rail>
      ) : null}

      {showSection("albums") &&
      (recommendationsQuery.isLoading || recommendations.length > 0) ? (
        <Rail title={t("components.music.Home.recommendationsToday")}>
          {recommendationsQuery.isLoading ? (
            <RailSkeletons />
          ) : (
            recommendations.map((album, i) => (
              <Tile
                key={`album-${i}-${album.name ?? "null"}`}
                title={album.name || t("components.music.Home.unknownAlbum")}
                subtitle={
                  artistDisplayName(album.artist) ?? t("components.music.Home.unknownArtist")
                }
                artwork={nodeArtwork(album.artwork_fs_node_id)}
                onPress={() =>
                  router.push(
                    albumRoute(album.artist_slug ?? artistRouteSegment(album.artist), album.name),
                  )
                }
              />
            ))
          )}
        </Rail>
      ) : null}

      {showSection("playlists") && (playlistsQuery.isLoading || playlists.length > 0) ? (
        <Rail
          title={t("components.music.Home.yourPlaylists")}
          showAllLabel={t("components.music.Home.showAll")}
          onShowAll={() => router.push("/(main)/playlists")}
        >
          {playlistsQuery.isLoading ? (
            <RailSkeletons />
          ) : (
            playlists.map((playlist) => (
              <Tile
                key={playlist.id}
                title={playlist.name}
                subtitle={t("components.music.Home.playlistSubtitle")}
                artwork={playlistArtworkSource(playlist)}
                onPress={() => router.push(playlistRoute(playlist.id))}
              />
            ))
          )}
        </Rail>
      ) : null}

      {showSection("artists") && topArtists.length > 0 ? (
        <Rail
          title={t("components.music.Home.yourArtists")}
          showAllLabel={t("components.music.Home.showAll")}
          onShowAll={() => router.push("/(main)/artists")}
        >
          {topArtists.map((row, i) => {
            const name =
              artistDisplayName(row.artist) ?? t("components.music.Home.unknownArtist");
            const segment = artistRouteSegment(row.artist) ?? "null";
            return (
              <Tile
                key={`top-artist-${i}-${name}`}
                title={name}
                subtitle={t("components.music.Home.artistSubtitle")}
                shape="circle"
                artwork={
                  typeof row.artist === "object"
                    ? artistImageSource(row.artist, "sm")
                    : { kind: "initials", name }
                }
                onPress={() => router.push(artistRoute(segment))}
              />
            );
          })}
        </Rail>
      ) : null}
    </ScrollView>
  );
}
