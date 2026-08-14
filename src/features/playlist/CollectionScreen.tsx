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
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { recordRecentCollection, type RecentCollection } from "@/lib/recentCollections";
import type { SongMenuItem } from "@/contracts/songMenu";
import type { ArtworkSource } from "@/domain/artwork";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import {
  ActionBar,
  EmptyState,
  ErrorState,
  getDownloadStatusReader,
  GhostIconButton,
  Hero,
  heroMinHeight,
  HeroSkeleton,
  songRowHeight,
  SongTable,
  SongTableHeader,
  SongTableSkeleton,
  StickyTitle,
  PlayFab,
  useContainerWidth,
  useDesktopShell,
  useDownloadStatusVersion,
  type ActionBarMenuItem,
  type CollectionViewMode,
  type HeroKind,
  type SongRowColumn,
} from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";
import {
  readCollectionViewMode,
  writeCollectionViewMode,
} from "@/features/shell/desktop/layoutPrefs";
import {
  getOfflineCollectionsApi,
  useOfflineCollectionsVersion,
} from "./offlineCollections";

const ACTION_BAR_APPROX_HEIGHT = 92;
/**
 * Desktop sticky geometry (plan 4.3, collection row): the title bar is a
 * fixed 64px so the opaque column header can pin EXACTLY under it - the
 * mobile shell keeps its padding-derived bar and no pinned header.
 */
const DESKTOP_STICKY_BAR_HEIGHT = 64;

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
  const { tokens } = useTheme();
  const { height } = useWindowDimensions();
  const bottomPadding = useContentBottomPadding();
  const listRef = useRef<FlatList<Song>>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();

  /**
   * Measured height of Hero + ActionBar (the list header block). On desktop
   * the hero is width-capped, not a window fraction, so the sticky
   * thresholds must come from what actually rendered - the mobile shell
   * keeps its original fraction math untouched below.
   */
  const [headerHeight, setHeaderHeight] = useState(0);

  /**
   * View mode, persisted PER COLLECTION (plan 4.5). The offline key is the
   * most stable identity; accentKey covers albums/mixes/radios; the
   * kind+title pair is the fallback for surfaces with neither. Desktop
   * only - the mobile shell always renders the full list rows.
   */
  const viewKey = collectionKey ?? accentKey ?? `${kind}:${title}`;
  const [viewMode, setViewMode] = useState<CollectionViewMode>(() =>
    readCollectionViewMode(viewKey),
  );
  // The key can settle after mount (title arrives with the query): re-read
  // the stored mode for the new identity DURING render, the documented
  // adjust-state-on-prop-change pattern - no effect, no cascading render.
  const [hydratedViewKey, setHydratedViewKey] = useState(viewKey);
  if (hydratedViewKey !== viewKey) {
    setHydratedViewKey(viewKey);
    setViewMode(readCollectionViewMode(viewKey));
  }
  const selectViewMode = useCallback(
    (mode: CollectionViewMode) => {
      setViewMode(mode);
      writeCollectionViewMode(viewKey, mode);
    },
    [viewKey],
  );
  const compact = desktopShell && viewMode === "compact";

  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const playing = usePlaybackView((v) => v.playing);
  const likedIdsQuery = useLikedIds();
  const likedIds = useMemo(
    () => new Set<number>(likedIdsQuery.data ?? []),
    [likedIdsQuery.data],
  );
  // Hover heart (plan 4.3, desktop shell): the optimistic toggle every
  // other heart already uses. SongTable only grows the button >= 900px.
  const toggleLike = useToggleLike();
  const handleToggleLike = useCallback(
    (song: Song, liked: boolean) => toggleLike.mutate({ songId: song.id, liked }),
    [toggleLike],
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

  /**
   * Fallback header estimate until onLayout reports: desktop derives it
   * from the width-capped hero (breakpoints.heroMinHeight), mobile from the
   * shipped window fraction. Real measurements replace both.
   */
  const estimatedHeaderHeight =
    (desktopShell
      ? heroMinHeight(containerWidth, kind === "artist")
      : Math.round(height * (kind === "artist" ? 0.42 : 0.36))) + ACTION_BAR_APPROX_HEIGHT;
  const measuredHeaderHeight = headerHeight > 0 ? headerHeight : estimatedHeaderHeight;

  const heroThreshold = desktopShell
    ? Math.max(0, measuredHeaderHeight - DESKTOP_STICKY_BAR_HEIGHT)
    : Math.round(height * (kind === "artist" ? 0.42 : 0.36)) - 60;
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
    const offset = Math.max(
      0,
      measuredHeaderHeight + index * songRowHeight(compact) - height / 3,
    );
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset, animated: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [highlightTitle, visibleSongs, height, measuredHeaderHeight, compact]);

  /**
   * View-mode control (plan 4.3: list / compact in the action bar, between
   * hero and list). Desktop shell only; the mobile action bar is frozen.
   */
  const viewModeSlot = desktopShell ? (
    <>
      <GhostIconButton
        icon="list"
        onPress={() => selectViewMode("list")}
        active={viewMode === "list"}
        accessibilityLabel={t("native.desktop.viewList")}
      />
      <GhostIconButton
        icon="rows-3"
        onPress={() => selectViewMode("compact")}
        active={viewMode === "compact"}
        accessibilityLabel={t("native.desktop.viewCompact")}
      />
    </>
  ) : undefined;

  const header = (
    // The wrapper measures Hero + ActionBar as one block: on desktop the
    // sticky thresholds derive from this measurement, not from the window.
    <View onLayout={(event) => setHeaderHeight(Math.round(event.nativeEvent.layout.height))}>
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
        rightSlot={viewModeSlot}
      />
    </View>
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
        onToggleLike={handleToggleLike}
        extraActionsFor={extraActionsFor}
        onReorder={showOnlyDownloaded ? undefined : onReorder}
        compact={compact}
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
        barHeight={desktopShell ? DESKTOP_STICKY_BAR_HEIGHT : undefined}
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
      {/*
        Desktop sticky column header (plan 4.3): once the in-flow header
        scrolls under the title bar, an OPAQUE copy pins at top: 64 - the
        same component as the in-flow header, so the columns can never
        drift. Mobile keeps scroll-away headers; nothing renders here.
      */}
      {desktopShell && stickyVisible && showTableHeader && visibleSongs.length > 0 ? (
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
            columns={columns}
            hasPlays={!!playCounts && Object.keys(playCounts).length > 0}
            reorder={!showOnlyDownloaded && !!onReorder}
            // This copy only exists on desktop, where the like column is on.
            hasLike
            backgroundColor={tokens.background}
          />
        </View>
      ) : null}
    </View>
  );
};
