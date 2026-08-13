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
import { useLikedIds, useLikedInfinite } from "@/api/queries/likedSongs";
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
  HeroSkeleton,
  LikedArtwork,
  PlayFab,
  SongTable,
  SongTableSkeleton,
  StickyTitle,
} from "@/ui";

const HERO_ARTWORK_SIZE = 136;

export default function LikedScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const { height } = useWindowDimensions();
  const bottomPadding = useContentBottomPadding();
  const [scrollY, setScrollY] = useState(0);

  const likedQuery = useLikedInfinite();
  const likedIdsQuery = useLikedIds();
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
        meta={`${songs.length} ${t("components.music.LikedSongsView.songs")}`}
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
        visible={scrollY > Math.round(height * 0.36) - 72}
        title={title}
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
    </View>
  );
}
