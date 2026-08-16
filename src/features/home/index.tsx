/**
 * Home (FR-23..29), rewritten mobile-first (owner requests 2026-08-08/11):
 *
 *  - the filter pills ARE the header (Spotify's top-of-home idiom); pills
 *    only show/hide sections, never refetch (FR-23);
 *  - QUICK GRID (2x4): Gostadas first, then what was ACTUALLY played last -
 *    local recently-played collections (lib/recentCollections) merged with
 *    the server's recent albums - playlists padding leftover cells;
 *  - rails, in listening order: mixes made for you, recently played (the
 *    albums beyond the grid), your artists, discovery (random albums), your
 *    playlists;
 *  - the friends strip stays LAST: worth a glance, not worth pushing your
 *    own library off screen;
 *  - every section fades in with a small stagger (entering animations), and
 *    each collapses silently when its query settles empty.
 */
import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
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
import { albumRoute, artistRadioRoute, artistRoute, mixRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { FONT_DRUK_WIDE } from "@/theme/typography";
import {
  artworkSourceUri,
  FilterPills,
  MixTile,
  MixTileArtwork,
  Rail,
  Skeleton,
  Tile,
  TILE_WIDTH,
  TileSkeleton,
  TopTileGrid,
  type TopTileItem,
} from "@/ui";
 import { getRecentCollections, subscribeRecentCollections } from "@/lib/recentCollections";
import { HeaderAvatar } from "@/features/shell/HeaderAvatar";
import { useFriendsStripActive, useFriendsStripSlot } from "./friendsSlot";

type HomeFilter = "all" | "playlists" | "albums" | "artists";

/** Grid cells on a phone (2 columns x 4 rows, Spotify-shaped), Gostadas included. */
const QUICK_GRID_ITEMS = 8;
/** Recents the grid absorbs; the rest feed the "recently played" rail. */
const QUICK_GRID_RECENTS = 7;
/** One fetch feeds grid + rail. */
const RECENT_ALBUMS_LIMIT = 12;

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

  // Puxar para refrescar: a valvula de escape do ecra. As tabs mantem a Home
  // montada, portanto uma query que ERROU (rede fria no arranque) nunca mais
  // era refeita por navegacao nenhuma - as seccoes colapsavam em silencio e o
  // "Tudo" abria vazio ate se matar a app (dono, 2026-08-17). O retry do
  // queryClient trata do caso comum sozinho; isto da ao utilizador o gesto
  // universal para o resto.
  const [refreshing, setRefreshing] = useState(false);
  const refetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        recentAlbumsQuery.refetch(),
        mixesQuery.refetch(),
        playlistsQuery.refetch(),
        recommendationsQuery.refetch(),
        topArtistsQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
    // As queries sao objectos novos por render; os refetch, nao. Depender das
    // funcoes estaveis evita recriar o callback a cada frame de dados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recentAlbumsQuery.refetch,
    mixesQuery.refetch,
    playlistsQuery.refetch,
    recommendationsQuery.refetch,
    topArtistsQuery.refetch,
  ]);

  const recentAlbums = useMemo(() => recentAlbumsQuery.data ?? [], [recentAlbumsQuery.data]);
  const playlists = playlistsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? [];
  const topArtists = topArtistsQuery.data ?? [];
  const mixes = mixesQuery.data ?? [];

  // ----- quick grid: Gostadas + what was ACTUALLY played last --------------
  // Two recency sources merged: the LOCAL record of collections a queue was
  // started from (playlists, albums, mixes, liked - the server knows nothing
  // about collection context) and the server's recent ALBUMS (which cover
  // other devices). Deduped, newest first; playlists pad any leftover cells.
  const localRecents = useSyncExternalStore(
    subscribeRecentCollections,
    getRecentCollections,
    getRecentCollections,
  );

  const recentTiles = useMemo(() => {
    const out: { at: number; item: TopTileItem }[] = [];
    const seen = new Set<string>();
    for (const entry of localRecents) {
      if (entry.kind === "liked" || entry.kind === "radio") continue;
      const id = `${entry.kind}:${entry.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const artwork: ArtworkSource = entry.heart
        ? { kind: "likedHeart" }
        : entry.artworkNodeId
          ? { kind: "node", nodeId: entry.artworkNodeId }
          : entry.artworkUrl
            ? { kind: "external", url: entry.artworkUrl }
            : { kind: "placeholder" };
      const onPress = (): void => {
        if (entry.kind === "playlist") {
          router.push(playlistRoute(Number(entry.key)));
        } else if (entry.kind === "album") {
          const split = entry.key.indexOf("::");
          router.push(albumRoute(entry.key.slice(0, split), entry.key.slice(split + 2)));
        } else if (entry.kind === "mix") {
          router.push(mixRoute(entry.key));
        }
      };
      out.push({ at: entry.at, item: { key: id, title: entry.title, artwork, onPress } });
    }
    for (const album of recentAlbums) {
      const segment = artistRouteSegment(album.artist) ?? "null";
      const id = `album:${segment}::${album.album ?? "null"}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        at: Date.parse(album.last_played_at) || 0,
        item: {
          key: id,
          title: album.album || t("components.music.Home.unknownAlbum"),
          artwork: nodeArtwork(album.artwork_media_id),
          onPress: () => router.push(albumRoute(segment, album.album)),
        },
      });
    }
    out.sort((a, b) => b.at - a.at);
    return out.map((x) => x.item);
  }, [localRecents, recentAlbums, router, t]);

  const quickItems: TopTileItem[] = [
    {
      key: "liked",
      title: t("components.music.Sidebar.liked"),
      artwork: { kind: "likedHeart" },
      onPress: () => router.push("/liked"),
    },
    ...recentTiles.slice(0, QUICK_GRID_RECENTS),
  ];
  for (const playlist of playlists) {
    if (quickItems.length >= QUICK_GRID_ITEMS) break;
    if (quickItems.some((item) => item.key === `playlist:${playlist.id}`)) continue;
    quickItems.push({
      key: `playlist:${playlist.id}`,
      title: playlist.name,
      artwork: playlistArtworkSource(playlist),
      onPress: () => router.push(playlistRoute(playlist.id)),
    });
  }

  // The rail keeps the full server-side recents (a bit of overlap with the
  // grid is the Spotify shape too).
  const railRecents = recentAlbums;

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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refetchAll()}
          tintColor={tokens.mutedForeground}
          progressViewOffset={insets.top}
        />
      }
    >
      {/* O topo da Home a Spotify: as pills SAO o cabecalho, com o avatar no
          canto. Ele saiu daqui a 2026-08-14 para a barra de tabs e voltou a
          2026-08-16, quando a barra passou a ser a do sistema e deixou de
          poder carregar uma fotografia redonda. */}
      {/* Cabecalho proprio POR CIMA das pills (pedido do dono 2026-08-16):
          a marca a esquerda em Druk Wide, a mesma do omelhorsite.pt, e o
          avatar no canto. Ao lado das pills nao dava - a tira rola e a
          ultima era cortada a meio da palavra ao bater no avatar. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 24,
        }}
      >
        <Text
          style={{
            color: tokens.foreground,
            fontFamily: FONT_DRUK_WIDE,
            fontSize: 15,
            letterSpacing: 0.5,
          }}
        >
          OMS Music
        </Text>
        <HeaderAvatar />
      </View>
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
                const artistSegment = mix.artist ? artistRouteSegment(mix.artist) : null;
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
                    artistName={mix.artist?.name ?? null}
                    onPressArtist={
                      artistSegment
                        ? () => router.push(artistRoute(artistSegment))
                        : undefined
                    }
                  />
                );
              })
            )}
          </Rail>
        </Section>
      ) : null}

      {/* Como as outras rails: skeleton enquanto carrega, colapso so quando a
          resposta CHEGOU vazia. Sem o ramo de loading estas duas seccoes
          saltavam para dentro do ecra depois do primeiro frame. */}
      {showSection("albums") && (recentAlbumsQuery.isLoading || railRecents.length > 0) ? (
        <Section order={2}>
          <Rail title={t("native.home.recentlyPlayed")}>
            {recentAlbumsQuery.isLoading ? (
              <RailSkeletons />
            ) : (
            railRecents.map((album, i) => (
              <Tile
                key={`recent-rail-${i}-${album.album ?? "null"}`}
                title={album.album || t("components.music.Home.unknownAlbum")}
                subtitle={
                  artistDisplayName(album.artist) ?? t("components.music.Home.unknownArtist")
                }
                artwork={nodeArtwork(album.artwork_media_id)}
                onPress={() =>
                  router.push(albumRoute(artistRouteSegment(album.artist), album.album))
                }
              />
            ))
            )}
          </Rail>
        </Section>
      ) : null}

      {showSection("artists") && (topArtistsQuery.isLoading || topArtists.length > 0) ? (
        <Section order={3}>
          <Rail
            title={t("components.music.Home.yourArtists")}
            showAllLabel={t("components.music.Home.showAll")}
            onShowAll={() => router.push("/artists")}
          >
            {topArtistsQuery.isLoading ? (
              <RailSkeletons />
            ) : (
            topArtists.map((row, i) => {
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
            })
            )}
          </Rail>
        </Section>
      ) : null}

      {/* Radios para ti (pedido do dono, 2026-08-18): seeds dos artistas que
          o utilizador realmente ouve. So no "Tudo" - uma radio nao e artista
          nem album, e um filtro que a mostrasse mentia. */}
      {filter === "all" && topArtists.length > 0 ? (
        <Section order={4}>
          <Rail title={t("components.music.Home.radiosForYou")}>
            {topArtists.slice(0, 8).map((row, i) => {
              const name =
                artistDisplayName(row.artist) ?? t("components.music.Home.unknownArtist");
              const segment = artistRouteSegment(row.artist) ?? "null";
              const uri =
                typeof row.artist === "object"
                  ? artworkSourceUri(artistImageSource(row.artist, "sm"))
                  : null;
              return (
                <Pressable
                  key={`radio-${i}-${name}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("components.music.Hero.radio")}: ${name}`}
                  onPress={() => router.push(artistRadioRoute(segment))}
                  style={({ pressed }) => ({
                    width: TILE_WIDTH,
                    gap: 8,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <MixTileArtwork
                    kind="top_artist"
                    stamp={name}
                    artworkUri={uri}
                    size={TILE_WIDTH}
                    icon="radio"
                  />
                  <View style={{ minWidth: 0 }}>
                    <Text
                      style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                      {t("components.music.Hero.radio")}
                    </Text>
                  </View>
                </Pressable>
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
                  artwork={nodeArtwork(album.artwork_media_id)}
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
            onShowAll={() => router.push("/playlists")}
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
