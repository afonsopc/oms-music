/**
 * Shared collection screen body (web MediaCollectionView parity, FR-48/43/
 * 121/122 shells): Hero + StickyTitle + ActionBar + windowed SongTable in
 * ONE virtualized list, bottom-padded so the MiniPlayer never covers list
 * tails (FR-16). Used by the playlist, album, mix and radio screens - all
 * WP6 surfaces.
 *
 * Downloads plumbing: the ActionBar offline toggle renders only when the
 * offline-collections bridge is installed AND a `collectionKey` is given
 * (FR-87); while "show only downloaded" is active the visible rows narrow
 * to done downloads and reorder is suppressed (visual indexes would lie,
 * FR-93 via WP8's settings).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { useLikedIds } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { recordRecentCollection, type RecentCollection } from "@/lib/recentCollections";
import type { SongMenuItem } from "@/contracts/songMenu";
import type { ArtworkSource } from "@/domain/artwork";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import {
  ActionBar,
  EmptyState,
  ErrorState,
  getDownloadStatusReader,
  Hero,
  HeroSkeleton,
  SongTable,
  SongTableSkeleton,
  StickyTitle,
  PlayFab,
  useDownloadStatusVersion,
  type ActionBarMenuItem,
  type HeroKind,
  type SongRowColumn,
} from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";
import {
  getOfflineCollectionsApi,
  useOfflineCollectionsVersion,
} from "./offlineCollections";

const ACTION_BAR_APPROX_HEIGHT = 92;

export interface CollectionScreenProps {
  kind: HeroKind;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  image?: ArtworkSource | null;
  artworkSlot?: React.ReactNode;
  accentColor?: string;
  accentKey?: string;
  /** Accent-extraction URI when the artwork slot hides the real image. */
  extractionUri?: string | null;
  songs: Song[];
  isLoading?: boolean;
  isError?: boolean;
  errorText?: string;
  emptyText?: string;
  onRetry?: () => void;
  columns?: SongRowColumn[];
  addedAtFor?: (song: Song, index: number) => string | undefined;
  playCounts?: Readonly<Record<number, number>>;
  showTableHeader?: boolean;
  surface?: string;
  extraActionsFor?: (song: Song, index: number) => SongMenuItem[] | undefined;
  /** Reorder over the FULL list; suppressed while filtering downloads. */
  onReorder?: (fromVisible: number, toVisible: number) => void;
  onStartRadio?: () => void;
  onAdd?: () => void;
  addLabel?: string;
  playLoading?: boolean;
  menuItems?: ActionBarMenuItem[];
  /** Offline keep-synced key: `'<playlistId>'` or an albumKey (FR-87). */
  collectionKey?: string;
  /** Deep-link song highlight + scroll (FR-44). */
  highlightTitle?: string | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /**
   * Identity recorded into the local recently-played-collections store the
   * moment any play starts here (home quick grid, owner request 2026-08-11).
   */
  recentEntry?: Omit<RecentCollection, "at">;
}

export const CollectionScreen = ({
  kind,
  title,
  subtitle,
  meta,
  image,
  artworkSlot,
  accentColor,
  accentKey,
  extractionUri,
  songs,
  isLoading = false,
  isError = false,
  errorText,
  emptyText,
  onRetry,
  columns = ["index", "title", "album", "addedAt", "duration"],
  addedAtFor,
  playCounts,
  showTableHeader = true,
  surface = "row",
  extraActionsFor,
  onReorder,
  onStartRadio,
  onAdd,
  addLabel,
  playLoading = false,
  menuItems,
  collectionKey,
  highlightTitle,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  recentEntry,
}: CollectionScreenProps) => {
  const t = useT();
  const { height } = useWindowDimensions();
  const bottomPadding = useContentBottomPadding();
  const listRef = useRef<FlatList<Song>>(null);
  const [stickyVisible, setStickyVisible] = useState(false);

  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const playing = usePlaybackView((v) => v.playing);
  const likedIdsQuery = useLikedIds();
  const likedIds = useMemo(
    () => new Set<number>(likedIdsQuery.data ?? []),
    [likedIdsQuery.data],
  );

  // Offline bridge: toggle + show-only-downloaded filter.
  useOfflineCollectionsVersion();
  const downloadVersion = useDownloadStatusVersion();
  const offlineApi = getOfflineCollectionsApi();
  const showOnlyDownloaded = offlineApi?.getShowOnlyDownloaded() ?? false;
  const isOffline =
    offlineApi && collectionKey ? offlineApi.isOfflineCollection(collectionKey) : false;

  const visibleSongs = useMemo(() => {
    if (!showOnlyDownloaded) return songs;
    const reader = getDownloadStatusReader();
    return songs.filter((s) => reader.getStatus(s.id) === "done");
    // downloadVersion keeps the filter fresh as downloads finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, showOnlyDownloaded, downloadVersion]);

  const isPlayingThisCollection =
    playing && currentSongId != null && visibleSongs.some((s) => s.id === currentSongId);

  // Any play from this screen marks the collection as recently played.
  const markRecent = useCallback(() => {
    if (recentEntry) recordRecentCollection(recentEntry);
  }, [recentEntry]);

  const handlePlay = useCallback(() => {
    if (visibleSongs.length === 0) return;
    if (isPlayingThisCollection) {
      getTransport().toggle();
      return;
    }
    markRecent();
    getTransport().setQueue(visibleSongs, 0);
  }, [visibleSongs, isPlayingThisCollection, markRecent]);

  const handleShuffle = useCallback(() => {
    if (visibleSongs.length === 0) return;
    markRecent();
    getTransport().setQueue(visibleSongs, undefined, { shuffle: true });
  }, [visibleSongs, markRecent]);

  const handleRowPlay = useCallback(
    (_song: Song, index: number) => {
      markRecent();
      getTransport().setQueue(visibleSongs, index);
    },
    [visibleSongs, markRecent],
  );

  const handleToggleOffline = useCallback(() => {
    if (!offlineApi || !collectionKey) return;
    void offlineApi.toggleOfflineCollection(collectionKey, songs);
  }, [offlineApi, collectionKey, songs]);

  const heroThreshold = Math.round(height * (kind === "artist" ? 0.42 : 0.36)) - 60;
  const handleScrollOffset = useCallback(
    (offsetY: number) => {
      setStickyVisible(offsetY > heroThreshold);
    },
    [heroThreshold],
  );

  // FR-44 (P2): scroll the highlighted row into view once songs land. The
  // header height is approximated (fixed row height makes the rest exact).
  const highlightedOnce = useRef(false);
  useEffect(() => {
    if (!highlightTitle || highlightedOnce.current || visibleSongs.length === 0) return;
    const index = visibleSongs.findIndex((s) => s.title === highlightTitle);
    if (index < 0) return;
    highlightedOnce.current = true;
    const heroHeight = Math.round(height * (kind === "artist" ? 0.42 : 0.36));
    const offset = Math.max(0, heroHeight + ACTION_BAR_APPROX_HEIGHT + index * 56 - height / 3);
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset, animated: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [highlightTitle, visibleSongs, height, kind]);

  const header = (
    <>
      <Hero
        kind={kind}
        title={title}
        subtitle={subtitle}
        meta={meta}
        image={image}
        artworkSlot={artworkSlot}
        accentColor={accentColor}
        accentKey={accentKey}
        backdropUri={kind === "artist" ? undefined : (extractionUri ?? undefined)}
      />
      <ActionBar
        onPlay={visibleSongs.length > 0 || playLoading ? handlePlay : undefined}
        onShuffle={visibleSongs.length > 0 ? handleShuffle : undefined}
        onStartRadio={onStartRadio}
        onAdd={onAdd}
        addLabel={addLabel}
        onToggleOffline={offlineApi && collectionKey ? handleToggleOffline : undefined}
        isOffline={isOffline}
        isPlayingThisCollection={isPlayingThisCollection}
        playLoading={playLoading}
        menuItems={menuItems}
      />
    </>
  );

  const emptyComponent = isLoading ? (
    <SongTableSkeleton rows={8} />
  ) : isError ? (
    <ErrorState text={errorText} onRetry={onRetry} />
  ) : showOnlyDownloaded && songs.length > 0 ? (
    <EmptyState text={t("components.music.MediaCollectionView.onlyDownloadedEmpty")} />
  ) : (
    <EmptyState text={emptyText ?? t("components.music.MediaCollectionView.empty")} />
  );

  if (isLoading && !title) {
    // First mount with nothing at all resolved yet: full-page skeleton.
    return (
      <View style={{ flex: 1 }}>
        <HeroSkeleton artist={kind === "artist"} />
        <SongTableSkeleton rows={8} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SongTable
        listRef={listRef}
        songs={visibleSongs}
        columns={columns}
        addedAtFor={addedAtFor}
        playCounts={playCounts}
        likedIds={likedIds}
        currentSongId={currentSongId}
        isPlaying={playing}
        highlightTitle={highlightTitle}
        showHeader={showTableHeader && visibleSongs.length > 0}
        surface={surface}
        onPlay={handleRowPlay}
        extraActionsFor={extraActionsFor}
        onReorder={showOnlyDownloaded ? undefined : onReorder}
        header={header}
        footer={
          isLoadingMore ? (
            <View style={{ paddingVertical: 16 }}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        emptyComponent={emptyComponent}
        onEndReached={hasMore && !isLoadingMore ? onLoadMore : undefined}
        onScrollOffset={handleScrollOffset}
        contentBottomPadding={bottomPadding}
      />
      <StickyTitle
        visible={stickyVisible}
        title={title}
        leading={
          visibleSongs.length > 0 ? (
            <PlayFab
              playing={isPlayingThisCollection}
              onPress={handlePlay}
              size={34}
              accessibilityLabel={
                isPlayingThisCollection
                  ? t("components.music.ActionBar.pause")
                  : t("components.music.ActionBar.play")
              }
            />
          ) : undefined
        }
      />
    </View>
  );
};
