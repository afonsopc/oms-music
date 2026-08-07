/**
 * Home (FR-23..29), rewritten mobile-first (owner request 2026-08-08):
 *
 *  - time-of-day greeting, then the filter pills (Spotify's top-of-home
 *    idiom); pills only show/hide sections, never refetch (FR-23);
 *  - QUICK GRID: Gostadas first, then the albums you actually played last,
 *    playlists filling the empty cells - one thumb-reach block of "what you
 *    came here to press";
 *  - rails, in listening order: mixes made for you, recently played (the
 *    albums beyond the grid), your artists, discovery (random albums), your
 *    playlists;
 *  - the friends strip stays LAST: worth a glance, not worth pushing your
 *    own library off screen;
 *  - every section fades in with a small stagger (entering animations), and
 *    each collapses silently when its query settles empty.
 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
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

/** Grid cells on a phone (2 columns x 3 rows), Gostadas included. */
const QUICK_GRID_ITEMS = 6;
/** Recents the grid absorbs; the rest feed the "recently played" rail. */
const QUICK_GRID_RECENTS = 5;
/** One fetch feeds grid + rail. */
const RECENT_ALBUMS_LIMIT = 12;

/** Spotify-style time-of-day greeting key; evening covers the night hours. */
export const greetingKey = (
  hour: number,
): "native.home.goodMorning" | "native.home.goodAfternoon" | "native.home.goodEvening" => {
  if (hour >= 6 && hour < 13) return "native.home.goodMorning";
  if (hour >= 13 && hour < 20) return "native.home.goodAfternoon";
  return "native.home.goodEvening";
};

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

/** Sections cascade in: each mounts with a slightly later fade-up. */
const Section = ({ order, children }: { order: number; children: React.ReactNode }) => (
  <Animated.View entering={FadeInDown.duration(300).delay(order * 50)}>
    {children}
  </Animated.View>
);

export default function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = useContentBottomPadding();
  const [filter, setFilter] = useState<HomeFilter>("all");

  const recentAlbumsQuery = useRecentAlbums(RECENT_ALBUMS_LIMIT);
  const mixesQuery = useMixes();
  const playlistsQuery = usePlaylists({ page: "1:20" });
  const recommendationsQuery = useRandomAlbums(10);
  const topArtistsQuery = useTopArtists("30d", 10);

  const recentAlbums = recentAlbumsQuery.data ?? [];
  const playlists = playlistsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? [];
  const topArtists = topArtistsQuery.data ?? [];
  const mixes = mixesQuery.data ?? [];

  // ----- quick grid: Gostadas + last-played albums + playlists as filler ----
  const quickItems: TopTileItem[] = [
    {
      key: "liked",
      title: t("components.music.Sidebar.liked"),
      artwork: { kind: "likedHeart" },
      onPress: () => router.push("/(main)/liked"),
    },
    ...recentAlbums.slice(0, QUICK_GRID_RECENTS).map((album, i): TopTileItem => ({
      key: `recent-${i}-${album.album ?? "null"}`,
      title: album.album || t("components.music.Home.unknownAlbum"),
      artwork: nodeArtwork(album.artwork_fs_node_id),
      onPress: () =>
        router.push(albumRoute(artistRouteSegment(album.artist), album.album)),
    })),
  ];
  for (const playlist of playlists) {
    if (quickItems.length >= QUICK_GRID_ITEMS) break;
    quickItems.push({
      key: `playlist-${playlist.id}`,
      title: playlist.name,
      artwork: playlistArtworkSource(playlist),
      onPress: () => router.push(playlistRoute(playlist.id)),
    });
  }

  // The rail carries what the grid could not.
  const railRecents = recentAlbums.slice(QUICK_GRID_RECENTS);

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
        {t(greetingKey(new Date().getHours()))}
      </Text>

      <FilterPills
        pills={pills}
        activeKey={filter}
        onChange={(key) => setFilter(key as HomeFilter)}
      />

      {filter === "all" ? (
        recentAlbumsQuery.isLoading && playlistsQuery.isLoading ? (
          <View style={{ gap: 8, paddingHorizontal: 24 }}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} height={64} />
            ))}
          </View>
        ) : (
          <Section order={0}>
            <TopTileGrid items={quickItems} />
          </Section>
        )
      ) : null}

      {filter === "all" && (mixesQuery.isLoading || mixes.length > 0) ? (
        <Section order={1}>
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
        </Section>
      ) : null}

      {showSection("albums") && railRecents.length > 0 ? (
        <Section order={2}>
          <Rail title={t("native.home.recentlyPlayed")}>
            {railRecents.map((album, i) => (
              <Tile
                key={`recent-rail-${i}-${album.album ?? "null"}`}
                title={album.album || t("components.music.Home.unknownAlbum")}
                subtitle={
                  artistDisplayName(album.artist) ?? t("components.music.Home.unknownArtist")
                }
                artwork={nodeArtwork(album.artwork_fs_node_id)}
                onPress={() =>
                  router.push(albumRoute(artistRouteSegment(album.artist), album.album))
                }
              />
            ))}
          </Rail>
        </Section>
      ) : null}

      {showSection("artists") && topArtists.length > 0 ? (
        <Section order={3}>
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
        </Section>
      ) : null}

      {showSection("albums") &&
      (recommendationsQuery.isLoading || recommendations.length > 0) ? (
        <Section order={4}>
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
        </Section>
      ) : null}

      {showSection("playlists") && (playlistsQuery.isLoading || playlists.length > 0) ? (
        <Section order={5}>
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
        </Section>
      ) : null}

      {filter === "all" ? (
        <Section order={6}>
          <FriendsStrip />
        </Section>
      ) : null}
    </ScrollView>
  );
}
