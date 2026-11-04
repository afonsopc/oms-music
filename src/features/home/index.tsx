/**
 * Início (FR-23..29). Redesenho de 2026-11-04 (docs/redesenho.md, "O
 * padrão"): neutro, capas grandes, nada de cartões com gradiente.
 *
 *  - o topo é o TabHeader com o avatar e os filtros (Tudo/Playlists/Álbuns/
 *    Artistas); os filtros só mostram/escondem secções, nunca voltam a pedir
 *    nada (FR-23);
 *  - GRELHA RÁPIDA (2x4 no telemóvel): Gostadas primeiro, depois o que foi
 *    MESMO ouvido por último - as colecções tocadas neste aparelho
 *    (lib/recentCollections) juntas com os álbuns recentes do servidor - e
 *    playlists a preencher o que sobra; fundo cinzento neutro, sem cor;
 *  - "Feito para ti": as mixes numa fila e, por baixo, três linhas simples
 *    (DJ, Rewind, Assistente) no lugar dos antigos cartões coloridos;
 *  - filas de capas grandes: ouvido recentemente, os teus artistas, rádios,
 *    recomendações, as tuas playlists; os amigos ficam no fim;
 *  - cada secção entra em cascata (Reveal) e desaparece quando o pedido
 *    chega vazio. Se tudo falhar há "Tentar de novo"; se não houver nada,
 *    uma frase e o caminho para a Pesquisa.
 */
import React, { memo, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMixes } from "@/api/queries/mixes";
import { useRecentAlbums, useTopArtists } from "@/api/queries/playEvents";
import { usePlaylists } from "@/api/queries/playlists";
import { useRandomAlbums } from "@/api/queries/songs";
import { artistDisplayName, artistRouteSegment } from "@/domain/album";
import { artistImageSource, playlistArtworkSource, type ArtworkSource } from "@/domain/artwork";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { TabHeader } from "@/features/shell/TabHeader";
import { useT } from "@/i18n";
import { mixStampText, mixTitle } from "@/i18n/mixLabels";
import { hiddenByCollectionPlay } from "@/lib/albumPlayMarks";
import { getAlbumPlayMarks, subscribeAlbumPlayMarks } from "@/lib/playContext";
import { getRecentCollections, subscribeRecentCollections } from "@/lib/recentCollections";
import { albumRoute, artistRadioRoute, artistRoute, djRoute, mixRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import {
  ArtworkImage,
  artworkSourceUri,
  FilterPills,
  MixTileArtwork,
  Skeleton,
  topTileGridColumns,
  useContainerWidth,
  type TopTileItem,
} from "@/ui";
import { PressableScale, Reveal } from "@/ui/motion";
import { ListRow, PageState, SectionLabel, useGutter } from "@/ui/page";
import { ArtCard, ArtRail, useCardWidth } from "./artRail";
import { useFriendsStripActive, useFriendsStripSlot } from "./friendsSlot";

type HomeFilter = "all" | "playlists" | "albums" | "artists";

/** Células da grelha (2 colunas x 4 linhas no telemóvel), Gostadas incluídas. */
const QUICK_GRID_ITEMS = 8;
/** Recentes que a grelha absorve; o resto vai para a fila "ouvido recentemente". */
const QUICK_GRID_RECENTS = 7;
/** Um só pedido alimenta grelha e fila. */
const RECENT_ALBUMS_LIMIT = 12;
const GRID_GAP = 12;
const GRID_ROW = 56;

const nodeArtwork = (nodeId: string | null | undefined): ArtworkSource =>
  nodeId ? { kind: "node", nodeId } : { kind: "placeholder" };

/**
 * A fila dos amigos a ouvir (FR-29): o Início decide ONDE fica, o WP10 o
 * que mostra. Nada aparece enquanto o slot não estiver registado e activo.
 */
const FriendsStrip = () => {
  const slot = useFriendsStripSlot();
  const active = useFriendsStripActive(slot);
  if (!slot || !active) return null;
  const Content = slot.Component;
  return <Content />;
};

/** Secções em cascata (Reveal à mão: o `entering` ficava invisível na web). */
const Section = ({ order, children }: { order: number; children: React.ReactNode }) => (
  <Reveal order={order} step={50}>
    {children}
  </Reveal>
);

const QuickTile = memo(function QuickTile({ item, width }: { item: TopTileItem; width: number }) {
  const { tokens } = useTheme();
  return (
    <PressableScale
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      // Ronda 2: sem a caixa cinzenta: a capa
      // e o nome ao lado, mais nada.
      style={{
        width,
        height: GRID_ROW,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <ArtworkImage source={item.artwork} size={GRID_ROW} shape="rounded" />
      <Text
        numberOfLines={2}
        style={{ flex: 1, color: tokens.foreground, fontSize: 15, lineHeight: 19, fontWeight: "500", paddingRight: 4 }}
      >
        {item.title}
      </Text>
    </PressableScale>
  );
});

const QuickGrid = ({ items, loading }: { items: TopTileItem[]; loading: boolean }) => {
  const gutter = useGutter();
  const containerWidth = useContainerWidth();
  const columns = topTileGridColumns(containerWidth);
  const width = Math.floor((containerWidth - gutter * 2 - GRID_GAP * (columns - 1)) / columns);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingHorizontal: gutter }}>
      {loading
        ? Array.from({ length: QUICK_GRID_ITEMS }, (_, i) => (
            <Skeleton key={i} width={width} height={GRID_ROW} borderRadius={6} />
          ))
        : items.slice(0, QUICK_GRID_ITEMS).map((item) => <QuickTile key={item.key} item={item} width={width} />)}
    </View>
  );
};

export default function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = useContentBottomPadding();
  const cardWidth = useCardWidth();
  const [filter, setFilter] = useState<HomeFilter>("all");

  const recentAlbumsQuery = useRecentAlbums(RECENT_ALBUMS_LIMIT);
  const mixesQuery = useMixes();
  const playlistsQuery = usePlaylists({ limit: 20 });
  const recommendationsQuery = useRandomAlbums(10);
  const topArtistsQuery = useTopArtists("30d", 10);

  // Puxar para refrescar (e o "Tentar de novo" do erro): as tabs mantêm o
  // Início montado, portanto um pedido que falhou no arranque nunca mais era
  // refeito por navegação nenhuma (dono, 2026-08-17).
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
    // Os objectos das queries são novos a cada render; os refetch, não.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recentAlbumsQuery.refetch,
    mixesQuery.refetch,
    playlistsQuery.refetch,
    recommendationsQuery.refetch,
    topArtistsQuery.refetch,
  ]);

  const recentAlbums = useMemo(() => recentAlbumsQuery.data ?? [], [recentAlbumsQuery.data]);
  const playlists = useMemo(() => playlistsQuery.data ?? [], [playlistsQuery.data]);
  const recommendations = recommendationsQuery.data ?? [];
  const topArtists = topArtistsQuery.data ?? [];
  const mixes = mixesQuery.data ?? [];

  // ----- grelha rápida: Gostadas + o que foi MESMO ouvido por último -------
  // Duas fontes: o registo LOCAL das colecções de onde se começou a tocar
  // (o servidor não sabe de contexto) e os ÁLBUNS recentes do servidor (que
  // cobrem os outros aparelhos). Sem repetidos, mais recente primeiro.
  const localRecents = useSyncExternalStore(
    subscribeRecentCollections,
    getRecentCollections,
    getRecentCollections,
  );
  // Quais destas escutas vieram de DENTRO de uma colecção (lib/albumPlayMarks).
  const albumPlayMarks = useSyncExternalStore(
    subscribeAlbumPlayMarks,
    getAlbumPlayMarks,
    getAlbumPlayMarks,
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
      // Tocar uma playlist não é escolher os álbuns das faixas dela: um álbum
      // cuja última escuta veio de dentro de uma colecção fica de fora.
      if (hiddenByCollectionPlay(albumPlayMarks[id], album.last_played_at)) continue;
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
  }, [localRecents, albumPlayMarks, recentAlbums, router, t]);

  const quickItems = useMemo(() => {
    const items: TopTileItem[] = [
      {
        key: "liked",
        title: t("components.music.Sidebar.liked"),
        artwork: { kind: "likedHeart" },
        onPress: () => router.push("/liked"),
      },
      ...recentTiles.slice(0, QUICK_GRID_RECENTS),
    ];
    for (const playlist of playlists) {
      if (items.length >= QUICK_GRID_ITEMS) break;
      if (items.some((item) => item.key === `playlist:${playlist.id}`)) continue;
      items.push({
        key: `playlist:${playlist.id}`,
        title: playlist.name,
        artwork: playlistArtworkSource(playlist),
        onPress: () => router.push(playlistRoute(playlist.id)),
      });
    }
    return items;
  }, [recentTiles, playlists, router, t]);

  const shows = (kind: "playlists" | "albums" | "artists"): boolean =>
    filter === "all" || filter === kind;

  const queries = [recentAlbumsQuery, mixesQuery, playlistsQuery, recommendationsQuery, topArtistsQuery];
  const allFailed = queries.every((q) => q.isError);
  const anyLoading = queries.some((q) => q.isLoading);
  // O que cada filtro teria para mostrar; vazio só quando já tudo chegou.
  const hasContent =
    filter === "all"
      ? recentTiles.length + mixes.length + playlists.length + recommendations.length + topArtists.length > 0
      : filter === "playlists"
        ? playlists.length > 0
        : filter === "albums"
          ? recentAlbums.length + recommendations.length > 0
          : topArtists.length > 0;
  const showError = allFailed && localRecents.length === 0;
  const showEmpty = !anyLoading && !allFailed && !hasContent;

  const pills = [
    { key: "all", label: t("components.music.Home.filterAll") },
    { key: "playlists", label: t("components.music.Home.filterPlaylists") },
    { key: "albums", label: t("components.music.Home.filterAlbums") },
    { key: "artists", label: t("components.music.Home.filterArtists") },
  ];

  // As três portas que eram cartões com gradiente (DJ, Rewind, Assistente):
  // agora linhas simples debaixo das mixes. O assistente é uma tab: a rota
  // qualificada muda para ela em vez de empurrar uma cópia dentro do Início.
  const doors: { key: string; icon: "radio" | "history" | "sparkles"; title: string; meta: string; route: Href }[] = [
    {
      key: "dj",
      icon: "radio",
      title: t("components.music.Dj.homeBanner"),
      meta: t("components.music.Dj.homeBannerSubtitle"),
      route: djRoute,
    },
    {
      key: "rewind",
      icon: "history",
      title: t("components.music.Rewind.homeBanner"),
      meta: t("components.music.Rewind.homeBannerSubtitle"),
      route: "/rewind",
    },
    {
      key: "assistant",
      icon: "sparkles",
      title: t("components.music.Assistant.homeBanner"),
      meta: t("components.music.Assistant.homeBannerSubtitle"),
      route: "/(main)/(tabs)/(assistant)/assistant",
    },
  ];

  const unknownAlbum = t("components.music.Home.unknownAlbum");
  const unknownArtist = t("components.music.Home.unknownArtist");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: bottomPadding + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refetchAll()}
          tintColor={tokens.mutedForeground}
          progressViewOffset={insets.top}
        />
      }
    >
      <TabHeader>
        <FilterPills
          pills={pills}
          activeKey={filter}
          onChange={(key) => setFilter(key as HomeFilter)}
          contentPaddingHorizontal={0}
          style={{ flexGrow: 0 }}
        />
      </TabHeader>

      {filter === "all" && !showError ? (
        <Section order={0}>
          <View style={{ paddingTop: 16 }}>
            <QuickGrid
              items={quickItems}
              loading={recentAlbumsQuery.isLoading && playlistsQuery.isLoading && localRecents.length === 0}
            />
          </View>
        </Section>
      ) : null}

      {showError ? (
        <PageState loading={false} error onRetry={() => void refetchAll()} />
      ) : null}

      {filter === "all" && !showError ? (
        <Section order={1}>
          {mixesQuery.isLoading || mixes.length > 0 ? (
            <ArtRail title={t("components.music.Home.madeForYou")} loading={mixesQuery.isLoading}>
              {mixes.map((mix) => {
                const title = mixTitle(mix, t);
                return (
                  <ArtCard
                    key={mix.slug}
                    title={title}
                    width={cardWidth}
                    onPress={() => router.push(mixRoute(mix.slug))}
                    art={
                      <MixTileArtwork
                        kind={mix.kind}
                        stamp={mixStampText(mix, title)}
                        artworkUri={mix.artist ? artworkSourceUri(artistImageSource(mix.artist, "sm")) : null}
                        size={cardWidth}
                      />
                    }
                  />
                );
              })}
            </ArtRail>
          ) : (
            <SectionLabel title={t("components.music.Home.madeForYou")} />
          )}
          <View style={{ paddingTop: 8 }}>
            {doors.map((door, i) => (
              <ListRow
                key={door.key}
                icon={door.icon}
                title={door.title}
                meta={door.meta}
                chevron
                last={i === doors.length - 1}
                onPress={() => router.push(door.route)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {/* Esqueleto enquanto carrega, colapso só quando a resposta CHEGOU vazia. */}
      {shows("albums") && (recentAlbumsQuery.isLoading || recentAlbums.length > 0) ? (
        <Section order={2}>
          <ArtRail title={t("native.home.recentlyPlayed")} loading={recentAlbumsQuery.isLoading}>
            {recentAlbums.map((album, i) => (
              <ArtCard
                key={`recent-${i}-${album.album ?? "null"}`}
                title={album.album || unknownAlbum}
                subtitle={artistDisplayName(album.artist) ?? unknownArtist}
                artwork={nodeArtwork(album.artwork_media_id)}
                width={cardWidth}
                onPress={() => router.push(albumRoute(artistRouteSegment(album.artist), album.album))}
              />
            ))}
          </ArtRail>
        </Section>
      ) : null}

      {shows("artists") && (topArtistsQuery.isLoading || topArtists.length > 0) ? (
        <Section order={3}>
          <ArtRail
            title={t("components.music.Home.yourArtists")}
            actionLabel={t("components.music.Home.showAll")}
            onAction={() => router.push("/artists")}
            loading={topArtistsQuery.isLoading}
            circle
          >
            {topArtists.map((row, i) => {
              const name = artistDisplayName(row.artist) ?? unknownArtist;
              const segment = artistRouteSegment(row.artist) ?? "null";
              return (
                <ArtCard
                  key={`artist-${i}-${name}`}
                  title={name}
                  circle
                  width={cardWidth}
                  artwork={typeof row.artist === "object" ? artistImageSource(row.artist, "sm") : { kind: "initials", name }}
                  onPress={() => router.push(artistRoute(segment))}
                />
              );
            })}
          </ArtRail>
        </Section>
      ) : null}

      {/* Rádios dos artistas que ouves: só no "Tudo" (uma rádio não é artista
          nem álbum, um filtro que a mostrasse mentia). */}
      {filter === "all" && topArtists.length > 0 ? (
        <Section order={4}>
          <ArtRail title={t("components.music.Home.radiosForYou")}>
            {topArtists.slice(0, 8).map((row, i) => {
              const name = artistDisplayName(row.artist) ?? unknownArtist;
              const segment = artistRouteSegment(row.artist) ?? "null";
              const uri = typeof row.artist === "object" ? artworkSourceUri(artistImageSource(row.artist, "sm")) : null;
              return (
                <ArtCard
                  key={`radio-${i}-${name}`}
                  title={name}
                  subtitle={t("components.music.Hero.radio")}
                  width={cardWidth}
                  onPress={() => router.push(artistRadioRoute(segment))}
                  art={<MixTileArtwork kind="top_artist" stamp={name} artworkUri={uri} size={cardWidth} icon="radio" />}
                />
              );
            })}
          </ArtRail>
        </Section>
      ) : null}

      {shows("albums") && (recommendationsQuery.isLoading || recommendations.length > 0) ? (
        <Section order={5}>
          <ArtRail title={t("components.music.Home.recommendationsToday")} loading={recommendationsQuery.isLoading}>
            {recommendations.map((album, i) => (
              <ArtCard
                key={`album-${i}-${album.name ?? "null"}`}
                title={album.name || unknownAlbum}
                subtitle={artistDisplayName(album.artist) ?? unknownArtist}
                artwork={nodeArtwork(album.artwork_media_id)}
                width={cardWidth}
                onPress={() =>
                  router.push(albumRoute(album.artist_slug ?? artistRouteSegment(album.artist), album.name))
                }
              />
            ))}
          </ArtRail>
        </Section>
      ) : null}

      {shows("playlists") && (playlistsQuery.isLoading || playlists.length > 0) ? (
        <Section order={6}>
          <ArtRail
            title={t("components.music.Home.yourPlaylists")}
            actionLabel={t("components.music.Home.showAll")}
            onAction={() => router.push("/playlists")}
            loading={playlistsQuery.isLoading}
          >
            {playlists.map((playlist) => (
              <ArtCard
                key={playlist.id}
                title={playlist.name}
                subtitle={t("components.music.Home.playlistSubtitle")}
                artwork={playlistArtworkSource(playlist)}
                width={cardWidth}
                onPress={() => router.push(playlistRoute(playlist.id))}
              />
            ))}
          </ArtRail>
        </Section>
      ) : null}

      {showEmpty ? (
        <PageState
          loading={false}
          empty
          emptyIcon="music"
          emptyText={t(filter === "all" ? "native.home.emptyAll" : "native.home.emptyFilter")}
          emptyActionLabel={t("native.home.emptyAction")}
          onEmptyAction={() => router.push("/search")}
        />
      ) : null}

      {filter === "all" ? (
        <Section order={7}>
          <View style={{ paddingTop: 28 }}>
            <FriendsStrip />
          </View>
        </Section>
      ) : null}
    </ScrollView>
  );
}
