/**
 * Liked songs (FR-45). Cursor-paged (`before=<liked_at>`, never an offset)
 * so liking something mid-scroll cannot shift the pages under the user.
 * Purple hero with the shared LikedArtwork tile and the `#7e22ce` accent,
 * play/shuffle, and `addedAt = liked_at` in the table.
 *
 * The table IS the screen's scroller: the hero and the action bar ride in
 * its list header so the whole surface stays one windowed list.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { useLikedIds, useLikedInfinite, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { recordRecentCollection } from "@/lib/recentCollections";
import type { Song } from "@/domain/song";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { LIKED_ACCENT } from "@/theme/tokens";
import {
  ActionBar,
  EmptyState,
  ErrorState,
  Hero,
  heroMinHeight,
  HeroSkeleton,
  LikedArtwork,
  PlayFab,
  SongTable,
  SongTableHeader,
  SongTableSkeleton,
  StickyTitle,
  useContainerWidth,
  useDesktopShell,
} from "@/ui";

const HERO_ARTWORK_SIZE = 136;
/** Matches CollectionScreen's desktop sticky bar (plan 4.3). */
const DESKTOP_STICKY_BAR_HEIGHT = 64;
const ACTION_BAR_APPROX_HEIGHT = 92;

export default function LikedScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const { height } = useWindowDimensions();
  const bottomPadding = useContentBottomPadding();
  const [scrollY, setScrollY] = useState(0);
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();

  // Mobile keeps the shipped fraction; desktop derives from the width-capped
  // hero (breakpoints.heroMinHeight) because the window fraction no longer
  // describes what rendered.
  const stickyThreshold = desktopShell
    ? heroMinHeight(containerWidth, false) - DESKTOP_STICKY_BAR_HEIGHT
    : Math.round(height * 0.36) - 72;
  const headerApproxHeight = desktopShell
    ? heroMinHeight(containerWidth, false) + ACTION_BAR_APPROX_HEIGHT
    : 0;

  const likedQuery = useLikedInfinite();
  const likedIdsQuery = useLikedIds();
  // Hover heart (plan 4.3): on THIS surface every row is liked, so the
  // button is really an inline "remove from liked" with the same
  // optimistic rollback as everywhere else.
  const toggleLike = useToggleLike();
  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const isPlaying = usePlaybackView((v) => v.playing);

  const rows = useMemo(() => likedQuery.data?.pages.flat() ?? [], [likedQuery.data]);
  const songs = useMemo<Song[]>(() => rows.map((row) => row.song), [rows]);
  const likedAt = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) map.set(row.song.id, row.liked_at);
    return map;
  }, [rows]);
  const likedIds = useMemo(() => new Set(likedIdsQuery.data ?? []), [likedIdsQuery.data]);

  const title = t("components.music.LikedSongsView.title");

  // The list is cursor-paged, so `songs.length` only counts the LOADED
  // pages and undersold the collection until the user scrolled to the end.
  // `/liked_songs/ids` already ships the complete set for the hearts, so
  // its size IS the server total; the pages only fill in as a fallback,
  // announced as a floor while more of them remain.
  const totalLiked = likedIdsQuery.data?.length ?? null;
  const heroMeta =
    totalLiked === null && likedQuery.hasNextPage
      ? t("native.desktop.moreThanSongs", { count: songs.length })
      : `${totalLiked ?? songs.length} ${t("components.music.LikedSongsView.songs")}`;

  if (likedQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <HeroSkeleton />
        <SongTableSkeleton />
      </View>
    );
  }

  if (likedQuery.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background, justifyContent: "center" }}>
        <ErrorState
          text={t("components.music.LikedSongsView.errorLoading")}
          onRetry={() => void likedQuery.refetch()}
        />
      </View>
    );
  }

  const markRecent = (): void => {
    recordRecentCollection({ kind: "liked", key: "liked", title, artworkNodeId: null, heart: true });
  };

  const play = (index: number): void => {
    markRecent();
    getTransport().setQueue(songs, index, { shuffle: false });
  };

  const shuffle = (): void => {
    markRecent();
    getTransport().setQueue(songs, undefined, { shuffle: true });
  };

  const header = (
    <>
      <Hero
        kind="playlist"
        subtitle={t("components.music.LikedSongsView.subtitle")}
        title={title}
        accentColor={LIKED_ACCENT}
        artworkSlot={<LikedArtwork size={HERO_ARTWORK_SIZE} />}
        meta={heroMeta}
      />
      <ActionBar
        onPlay={songs.length > 0 ? () => play(0) : undefined}
        onShuffle={songs.length > 0 ? shuffle : undefined}
      />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <SongTable
        songs={songs}
        columns={["index", "title", "album", "addedAt", "duration"]}
        addedAtFor={(song) => likedAt.get(song.id)}
        likedIds={likedIds}
        currentSongId={currentSongId}
        isPlaying={isPlaying}
        surface="liked"
        showHeader
        header={header}
        onPlay={(_song, index) => play(index)}
        onToggleLike={(song, liked) => toggleLike.mutate({ songId: song.id, liked })}
        onEndReached={() => {
          if (likedQuery.hasNextPage && !likedQuery.isFetchingNextPage) {
            void likedQuery.fetchNextPage();
          }
        }}
        onScrollOffset={setScrollY}
        contentBottomPadding={bottomPadding + 24}
        emptyComponent={
          <EmptyState icon="heart" text={t("components.music.LikedSongsView.empty")} />
        }
        footer={
          likedQuery.isFetchingNextPage ? (
            <View style={{ paddingVertical: 16, alignItems: "center" }}>
              <ActivityIndicator color={tokens.mutedForeground} />
            </View>
          ) : null
        }
      />
      <StickyTitle
        visible={scrollY > stickyThreshold}
        title={title}
        barHeight={desktopShell ? DESKTOP_STICKY_BAR_HEIGHT : undefined}
        leading={
          songs.length > 0 ? (
            <PlayFab
              onPress={() => play(0)}
              size={34}
              accessibilityLabel={t("components.music.ActionBar.play")}
            />
          ) : undefined
        }
      />
      {/* Desktop sticky column header (plan 4.3), as in CollectionScreen. */}
      {desktopShell && songs.length > 0 && scrollY > headerApproxHeight - DESKTOP_STICKY_BAR_HEIGHT ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: DESKTOP_STICKY_BAR_HEIGHT,
            left: 0,
            right: 0,
            zIndex: 29,
          }}
        >
          <SongTableHeader
            columns={["index", "title", "album", "addedAt", "duration"]}
            hasPlays={false}
            reorder={false}
            // This copy only exists on desktop, where the like column is on.
            hasLike
            backgroundColor={tokens.background}
          />
        </View>
      ) : null}
    </View>
  );
}
