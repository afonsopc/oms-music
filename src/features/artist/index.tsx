/**
 * Artist screen (FR-38..42).
 *
 * The `[artist]` segment is a slug OR a URL-encoded name: `GET /artists/:id`
 * resolves numeric ids, slugs and canonical names, so one request covers
 * both. A 404 is NOT an error state - the raw segment becomes the display
 * name so legacy name URLs still label the page while the metadata shim
 * fills in listeners and the bio.
 *
 * Row play in "Popular" looks the song up in the FULL primary catalog and
 * plays from there, so next/prev walk the whole discography (FR-39).
 *
 * The page is ONE virtualized list (the same SongTable/FlatList the
 * playlist's CollectionScreen rides): hero, action bar, top-5 and the album
 * grids live in the list header, "Aparece em" - the only section without a
 * ceiling - is the list's own data, and the bio is the footer. The previous
 * shape (two `scrollEnabled={false}` SongTables inside a ScrollView) mounted
 * EVERY row of a prolific artist's appearances up front; now they mount on
 * demand. The top-5 renders five plain SongRows instead of a nested table
 * because a FlatList inside another FlatList's header is a nested
 * VirtualizedList - five fixed rows cost nothing and nest nothing.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useArtist, useArtistMetadata } from "@/api/queries/artists";
import { useTopSongs } from "@/api/queries/playEvents";
import {
  findArtistSync,
  useArtistSyncs,
  useDisableArtistSync,
  useEnableArtistSync,
} from "@/api/queries/artistSyncs";
import { useArtistAlbums, useArtistPictures, useArtistSongs } from "@/api/queries/songs";
import { useLikedIds } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { artistKey } from "@/domain/albumKey";
import { artistBannerSource } from "@/domain/artwork";
import type { Song } from "@/domain/song";
import {
  getOfflineCollectionsApi,
  useOfflineCollectionsVersion,
} from "@/features/playlist/offlineCollections";
import { useLocale, useT } from "@/i18n";
import { artistRadioRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";
import {
  ActionBar,
  artworkSourceUri,
  EmptyState,
  GhostIconButton,
  ErrorState,
  Hero,
  HeroSkeleton,
  PlayFab,
  Skeleton,
  SongRow,
  SongTable,
  StickyTitle,
  type SongRowColumn,
} from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { AlbumGrid } from "./AlbumGrid";
import { ArtistPreviewStories } from "./PreviewStories";
import { ArtistGallery } from "./ArtistGallery";
import { htmlToParagraphs } from "./bioHtml";
import { hasOwnArtistImage, heroAvatarSource, heroBackdropUri } from "./images";

/**
 * The page's left edge, shared by every section, and equal to the one the
 * Hero, the ActionBar and the StickyTitle already use.
 *
 * They did not agree before: hero/actionbar/sticky sat at 24 while the
 * section titles, the bio and the album grid sat at 20, so the whole page
 * stepped in by 4px halfway down and never lined up again. That misalignment
 * is a good part of what the owner called a "hard" page on 2026-08-16
 * (point 15) - nothing on screen is wrong, but no two things share an edge.
 */
const SECTION_PADDING = 24;

/** Stable column set for every track row on this page: SongTable folds its
 *  renderItem into a memo, so the array identity must not change per render. */
const TRACK_COLUMNS: SongRowColumn[] = ["index", "title", "duration"];

/**
 * Section chrome with two levels of voice (owner point 15: "quatro blocos
 * quase idênticos empilhados e sem hierarquia entre um top-5 e uma
 * discografia inteira"). The artist's OWN catalog - "Populares" with its
 * numbered, play-counted rows and "Discografia" as the album grid - keeps
 * the full-size title; the appearances and the bio step down a size so the
 * page reads as one artist plus appendices, not five equal blocks.
 *
 * Rhythm: space belongs ABOVE a title (a single paddingTop per section, 40
 * primary / 32 secondary, `first` hugs the ActionBar's own 20px bottom the
 * way the playlist page's table does), and the title's 12px marginBottom is
 * the only gap before content - so children stay optional ("Aparece em"
 * renders its rows as the surrounding FlatList's data, not as children) and
 * the last section never dangles padding before the MiniPlayer inset.
 */
const Section = ({
  title,
  secondary = false,
  first = false,
  children,
}: {
  title: string;
  secondary?: boolean;
  first?: boolean;
  children?: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ paddingTop: first ? 8 : secondary ? 32 : 40 }}>
      <Text
        style={{
          color: tokens.foreground,
          fontSize: secondary ? 17 : 24,
          fontWeight: "700",
          letterSpacing: secondary ? -0.2 : -0.4,
          marginBottom: 12,
          paddingHorizontal: SECTION_PADDING,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
};

export default function ArtistScreen() {
  const params = useLocalSearchParams<{ artist: string }>();
  const segment = params.artist ?? "";
  const t = useT();
  const locale = useLocale();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const [stickyVisible, setStickyVisible] = useState(false);

  const artistQuery = useArtist(segment || null);
  const artistResource = artistQuery.data;
  // "Resolved" includes the 404 path: the raw segment still labels the page.
  const resolved = !segment || artistQuery.isSuccess || artistQuery.isError;
  const artistName = artistResource?.name || (resolved ? segment : "");
  const enabled = resolved && !!artistName;

  const albumsQuery = useArtistAlbums(artistName || null, "primary", enabled);
  const featuredAlbumsQuery = useArtistAlbums(artistName || null, "featured", enabled);
  const allSongsQuery = useArtistSongs(artistName || null, "primary", enabled);
  const featuredSongsQuery = useArtistSongs(artistName || null, "featured", enabled);
  const metadataQuery = useArtistMetadata(artistName || null, enabled);
  const topQuery = useTopSongs(artistName || null, { since: "all", limit: 5, enabled });
  // Lazily populates the Deezer picture columns server-side; skipped when the
  // resource already carries a picture worth showing.
  const picturesQuery = useArtistPictures(
    artistName || null,
    enabled && !hasOwnArtistImage(artistResource),
  );

  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);
  const featuredAlbums = useMemo(
    () => featuredAlbumsQuery.data ?? [],
    [featuredAlbumsQuery.data],
  );
  const allSongs = useMemo(() => allSongsQuery.data ?? [], [allSongsQuery.data]);
  const featuredSongs = useMemo(
    () => featuredSongsQuery.data ?? [],
    [featuredSongsQuery.data],
  );

  const picture = picturesQuery.data?.[0];
  const metadataImage = metadataQuery.data?.image_url ?? null;
  const resourceBannerUri = artistResource
    ? artworkSourceUri(artistBannerSource(artistResource))
    : null;
  const backdropUri = heroBackdropUri(resourceBannerUri, picture, metadataImage);
  const avatarSource = heroAvatarSource(artistResource, picture, metadataImage, artistName);

  const topRows = useMemo(() => topQuery.data ?? [], [topQuery.data]);
  const topSongs = useMemo<Song[]>(
    () => (topRows.length > 0 ? topRows.map((row) => row.song) : allSongs.slice(0, 5)),
    [topRows, allSongs],
  );
  const playCounts = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const row of topRows) map[row.song.id] = row.play_count;
    return map;
  }, [topRows]);

  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const playing = usePlaybackView((v) => v.playing);
  const likedIdsQuery = useLikedIds();
  const likedIds = useMemo(
    () => new Set<number>(likedIdsQuery.data ?? []),
    [likedIdsQuery.data],
  );

  const playFromAll = useCallback(
    (index: number) => {
      if (allSongs.length === 0) return;
      getTransport().setQueue(allSongs, index);
    },
    [allSongs],
  );

  // A popular row is played from its position in the full catalog so that
  // next/prev keep walking the discography (FR-39). A top song missing from
  // the primary list (data drift) is a no-op, matching the web.
  const playFromTop = useCallback(
    (song: Song) => {
      const index = allSongs.findIndex((s) => s.id === song.id);
      if (index < 0) return;
      playFromAll(index);
    },
    [allSongs, playFromAll],
  );

  const playFeatured = useCallback(
    (_song: Song, index: number) => {
      getTransport().setQueue(featuredSongs, index);
    },
    [featuredSongs],
  );

  const isPlayingThisArtist =
    playing && currentSongId != null && allSongs.some((s) => s.id === currentSongId);

  // Preview em stories (dono, 2026-08-18): excertos das top músicas por
  // cima da foto do artista - o segundo inquilino do StoryPager.
  const [previewOpen, setPreviewOpen] = useState(false);

  // Sync diário (3.5): a row casa por nome porque o cliente não guarda
  // spotify ids; ligar resolve o id pela pesquisa de imports. Enquanto o
  // backend do docs/propostas não estiver aplicado, a lista 404-a em
  // silêncio (guardedQueryFn) e o item do menu simplesmente não aparece.
  const artistSyncsQuery = useArtistSyncs(enabled);
  const enableSync = useEnableArtistSync();
  const disableSync = useDisableArtistSync();
  const syncRow = findArtistSync(artistSyncsQuery.data, artistName);
  const syncBusy = enableSync.isPending || disableSync.isPending;
  const syncMenuItems =
    artistSyncsQuery.isSuccess && artistName
      ? [
          {
            id: "daily-sync",
            label: syncRow
              ? t("components.music.ArtistView.dailySyncOff")
              : t("components.music.ArtistView.dailySyncOn"),
            icon: "cloud-check",
            disabled: syncBusy,
            onPress: () => {
              if (syncRow) disableSync.mutate(syncRow.id);
              else enableSync.mutate(artistName);
            },
          },
        ]
      : undefined;

  // Descarregar o artista INTEIRO (dono, 2026-08-17): a mesma ponte offline
  // dos ecrãs de playlist/álbum, com a chave "artist:<slug>". Só com o slug
  // resolvido - a chave tem de bater com a que o autoSync deriva das músicas
  // (primaryArtistSlug), e o segmento da rota pode ser um nome de exibição.
  useOfflineCollectionsVersion();
  const offlineApi = getOfflineCollectionsApi();
  const artistCollectionKey =
    artistResource?.slug && allSongs.length > 0 ? artistKey(artistResource.slug) : null;
  const artistIsOffline =
    offlineApi && artistCollectionKey ? offlineApi.isOfflineCollection(artistCollectionKey) : false;
  const handleToggleOffline =
    offlineApi && artistCollectionKey
      ? () => void offlineApi.toggleOfflineCollection(artistCollectionKey, allSongs)
      : undefined;

  const galleryUrls = artistResource?.gallery_image_urls ?? [];
  const bioParagraphs = useMemo(
    () => htmlToParagraphs(artistResource?.bio_html ?? metadataQuery.data?.bio_html),
    [artistResource?.bio_html, metadataQuery.data?.bio_html],
  );

  // The same sticky threshold the ScrollView version used; SongTable already
  // throttles and forwards the offset for CollectionScreen's identical need.
  const handleScrollOffset = useCallback((offsetY: number) => {
    setStickyVisible(offsetY > 200);
  }, []);

  if ((!!segment && artistQuery.isLoading) || (enabled && albumsQuery.isLoading)) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <HeroSkeleton artist />
        <View style={{ paddingHorizontal: SECTION_PADDING, gap: 12 }}>
          <Skeleton width="40%" height={28} />
          <Skeleton width="70%" height={16} />
        </View>
      </View>
    );
  }

  if (albumsQuery.isError) {
    return (
      <ErrorState
        text={t("components.music.ArtistView.errorLoadingAlbums")}
        onRetry={() => void albumsQuery.refetch()}
      />
    );
  }

  const title = artistName || t("components.music.ArtistView.unknownArtist");
  const listeners = metadataQuery.data?.lastfm_listeners ?? artistResource?.lastfm_listeners;

  const meta = [
    listeners
      ? `${listeners.toLocaleString(locale)} ${t("components.music.ArtistView.listeners")}`
      : null,
    `${albums.length} ${t("components.music.ArtistView.albums")}`,
    `${allSongs.length} ${t("components.music.ArtistView.songs")}`,
  ]
    .filter((part): part is string => part != null)
    .join(" • ");

  // Everything above the appearances rows: hero, actions, the top-5 and both
  // album grids. The "Aparece em" title also lives here so the FlatList's own
  // rows land straight under it.
  const listHeader = (
    <>
      <Hero
        kind="artist"
        title={title}
        meta={meta}
        image={avatarSource}
        backdropUri={backdropUri}
        accentKey={`artist:${artistResource?.id ?? segment}`}
      />
      <ActionBar
        onPlay={allSongs.length > 0 ? () => playFromAll(0) : undefined}
        onShuffle={
          allSongs.length > 0
            ? () => getTransport().setQueue(allSongs, undefined, { shuffle: true })
            : undefined
        }
        onStartRadio={
          artistName
            ? () => router.push(artistRadioRoute(artistResource?.slug || artistName))
            : undefined
        }
        onToggleOffline={handleToggleOffline}
        isOffline={artistIsOffline}
        isPlayingThisCollection={isPlayingThisArtist}
        menuItems={syncMenuItems}
        secondarySlot={
          topSongs.length > 0 ? (
            <GhostIconButton
              icon="sparkles"
              size={18}
              accessibilityLabel={t("components.music.ArtistView.previewStories")}
              onPress={() => setPreviewOpen(true)}
            />
          ) : undefined
        }
      />

      {topSongs.length > 0 ? (
        <Section title={t("components.music.ArtistView.popular")} first>
          {topSongs.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              columns={TRACK_COLUMNS}
              playCount={topRows.length > 0 ? (playCounts[song.id] ?? 0) : undefined}
              liked={likedIds.has(song.id)}
              isCurrent={currentSongId != null && currentSongId === song.id}
              isPlaying={playing}
              surface="artist"
              onPlay={() => playFromTop(song)}
            />
          ))}
        </Section>
      ) : null}

      <Section title={t("components.music.ArtistView.discography")}>
        {albums.length === 0 ? (
          <EmptyState
            icon="disc"
            text={t("components.music.ArtistView.noAlbumsFound")}
          />
        ) : (
          <AlbumGrid
            albums={albums}
            fallbackArtistSegment={artistResource?.slug || artistName || null}
          />
        )}
      </Section>

      {featuredAlbums.length > 0 ? (
        <Section title={t("components.music.ArtistView.participatesIn")} secondary>
          <AlbumGrid albums={featuredAlbums} showAlbumArtistSubtitle />
        </Section>
      ) : null}

      {featuredSongs.length > 0 ? (
        <Section title={t("components.music.ArtistView.featuredOn")} secondary />
      ) : null}
    </>
  );

  const listFooter =
    bioParagraphs.length > 0 || galleryUrls.length > 0 ? (
      <Section title={t("components.music.ArtistView.about")} secondary>
        <View style={{ paddingHorizontal: SECTION_PADDING, gap: 12 }}>
          {galleryUrls.length > 0 ? <ArtistGallery urls={galleryUrls} /> : null}
          {bioParagraphs.map((paragraph, index) => (
            <Text
              key={index}
              style={{ color: withAlpha(tokens.foreground, 0.9), fontSize: 14, lineHeight: 21 }}
            >
              {paragraph}
            </Text>
          ))}
          <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>
            {t("components.music.ArtistView.aboutAttribution")}
          </Text>
        </View>
      </Section>
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      {/* Sem "Aparece em" a lista fica vazia de propósito e sem empty state
          (o default do SongTable): o header É o conteúdo da página. */}
      <SongTable
        songs={featuredSongs}
        columns={TRACK_COLUMNS}
        likedIds={likedIds}
        currentSongId={currentSongId}
        isPlaying={playing}
        showHeader={false}
        surface="artist"
        onPlay={playFeatured}
        header={listHeader}
        footer={listFooter}
        onScrollOffset={handleScrollOffset}
        contentBottomPadding={bottomPadding}
      />
      {/* Modal overlay: renders nothing inline, so it lives outside the list
          and never re-renders with scroll. Keys/gestures are its own
          (previewSeek claims them before the global shortcuts). */}
      <ArtistPreviewStories
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        artistName={artistName}
        imageUri={backdropUri ?? artworkSourceUri(avatarSource)}
        songs={topSongs}
      />
      <StickyTitle
        visible={stickyVisible}
        title={title}
        leading={
          allSongs.length > 0 ? (
            <PlayFab
              playing={isPlayingThisArtist}
              onPress={() =>
                isPlayingThisArtist ? getTransport().toggle() : playFromAll(0)
              }
              size={34}
              accessibilityLabel={
                isPlayingThisArtist
                  ? t("components.music.ActionBar.pause")
                  : t("components.music.ActionBar.play")
              }
            />
          ) : undefined
        }
      />
    </View>
  );
}
