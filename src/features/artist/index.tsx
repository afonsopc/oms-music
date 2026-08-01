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
 */
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useArtist, useArtistMetadata } from "@/api/queries/artists";
import { useTopSongs } from "@/api/queries/playEvents";
import { useArtistAlbums, useArtistPictures, useArtistSongs } from "@/api/queries/songs";
import { useLikedIds } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { artistBannerSource } from "@/domain/artwork";
import type { Song } from "@/domain/song";
import { useLocale, useT } from "@/i18n";
import { usePlayerStore } from "@/player/store";
import { useTheme } from "@/theme/provider";
import {
  ActionBar,
  artworkSourceUri,
  EmptyState,
  ErrorState,
  Hero,
  HeroSkeleton,
  PlayFab,
  Skeleton,
  SongTable,
  StickyTitle,
} from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { artistRadioRoute } from "@/features/artists/routes";
import { AlbumGrid } from "./AlbumGrid";
import { ArtistGallery } from "./ArtistGallery";
import { htmlToParagraphs } from "./bioHtml";
import { hasOwnArtistImage, heroAvatarSource, heroBackdropUri } from "./images";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 12, paddingBottom: 28 }}>
      <Text
        style={{
          color: tokens.foreground,
          fontSize: 24,
          fontWeight: "700",
          letterSpacing: -0.4,
          paddingHorizontal: 20,
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

  const picture = picturesQuery.data?.pictures?.[0];
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

  const currentSongId = usePlayerStore((s) => s.currentSong?.id ?? null);
  const playing = usePlayerStore((s) => s.playing);
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

  const galleryUrls = artistResource?.gallery_image_urls ?? [];
  const bioParagraphs = useMemo(
    () => htmlToParagraphs(artistResource?.bio_html ?? metadataQuery.data?.bio_html),
    [artistResource?.bio_html, metadataQuery.data?.bio_html],
  );

  if ((!!segment && artistQuery.isLoading) || (enabled && albumsQuery.isLoading)) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <HeroSkeleton artist />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
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

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ScrollView
        onScroll={(e) => setStickyVisible(e.nativeEvent.contentOffset.y > 200)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
      >
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
          isPlayingThisCollection={isPlayingThisArtist}
        />

        {topSongs.length > 0 ? (
          <Section title={t("components.music.ArtistView.popular")}>
            <SongTable
              songs={topSongs}
              columns={["index", "title", "duration"]}
              playCounts={topRows.length > 0 ? playCounts : undefined}
              likedIds={likedIds}
              currentSongId={currentSongId}
              isPlaying={playing}
              showHeader={false}
              surface="artist"
              scrollEnabled={false}
              onPlay={(song) => playFromTop(song)}
            />
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
          <Section title={t("components.music.ArtistView.participatesIn")}>
            <AlbumGrid albums={featuredAlbums} showAlbumArtistSubtitle />
          </Section>
        ) : null}

        {featuredSongs.length > 0 ? (
          <Section title={t("components.music.ArtistView.featuredOn")}>
            <SongTable
              songs={featuredSongs}
              columns={["index", "title", "duration"]}
              likedIds={likedIds}
              currentSongId={currentSongId}
              isPlaying={playing}
              showHeader={false}
              surface="artist"
              scrollEnabled={false}
              onPlay={playFeatured}
            />
          </Section>
        ) : null}

        {bioParagraphs.length > 0 || galleryUrls.length > 0 ? (
          <Section title={t("components.music.ArtistView.about")}>
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {galleryUrls.length > 0 ? <ArtistGallery urls={galleryUrls} /> : null}
              {bioParagraphs.map((paragraph, index) => (
                <Text
                  key={index}
                  style={{ color: tokens.foreground, opacity: 0.9, fontSize: 14, lineHeight: 21 }}
                >
                  {paragraph}
                </Text>
              ))}
              <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>
                {t("components.music.ArtistView.aboutAttribution")}
              </Text>
            </View>
          </Section>
        ) : null}
      </ScrollView>
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
