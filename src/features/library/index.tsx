/**
 * Library tab (FR-35). Pills gate the queries (picking "Playlists" must
 * not pull the artist and album lists too), everything pages at the 500
 * ceiling, the filter box narrows locally, and the list is WINDOWED: a
 * 500-artist library must not fire 500 artwork requests on mount, so rows
 * render in small batches through a FlatList instead of all at once. Rows
 * are fixed height (getItemLayout), keyed by id and memoized: 1500 rows
 * scroll without measuring anything.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import {
  readLibraryViewMode,
  writeLibraryViewMode,
} from "@/features/shell/desktop/layoutPrefs";
import { TabHeader } from "@/features/shell/TabHeader";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

import {
  ArtworkImage,
  collectionGridColumns,
  EmptyState,
  ErrorState,
  FilterPills,
  GhostIconButton,
  useContainerWidth,
  useDesktopShell,
  type LibraryViewMode,
} from "@/ui";
import { Reveal, PressableScale } from "@/ui/motion";
import { ListSkeleton, PageState, pageType, useGutter } from "@/ui/page";
import { FilterField } from "./FilterField";
import { useLibraryAlbums, useLibraryArtists } from "./queries";
import {
  buildLibraryRows,
  likedLibraryRow,
  rowMatchesSearch,
  type LibraryFilter,
  type LibraryRow,
} from "./rows";

/** Rows rendered per window batch (web LIBRARY_PAGE_SIZE). */
const WINDOW_SIZE = 24;
/** Fixed row heights: what lets the list skip measuring (getItemLayout). */
const ROW_HEIGHT = 64;
const ROW_HEIGHT_COMPACT = 40;
const ROW_ARTWORK = 48;
/** Only the first screenful cascades in; rows further down just appear. */
const REVEAL_ROWS = 12;

/**
 * One library row: artwork, name, grey meta. No badge, no colour: a synced
 * playlist says so in the meta line only ("Playlist • Sincronizada").
 * Memoized and fed a stable `onOpen`, so a filter keystroke re-renders only
 * the rows whose data changed.
 */
const LibraryRowView = React.memo(function LibraryRowView({
  row,
  index,
  compact = false,
  onOpen,
}: {
  row: LibraryRow;
  index: number;
  /** Desktop compact mode (plan 4.3): no artwork, one line, denser. */
  compact?: boolean;
  onOpen: (row: LibraryRow) => void;
}) {
  const { tokens } = useTheme();
  const gutter = useGutter();
  const body = (
    <Pressable
      onPress={() => onOpen(row)}
      accessibilityRole="button"
      accessibilityLabel={row.name}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        height: compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT,
        paddingHorizontal: gutter,
        backgroundColor: pressed ? tokens.secondary : hovered ? tokens.accent : "transparent",
      })}
    >
      {compact ? null : (
        <ArtworkImage
          source={row.artwork}
          size={ROW_ARTWORK}
          shape={row.circular ? "circle" : "rounded"}
          recyclingKey={row.key}
        />
      )}
      {compact ? (
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 10 }}>
          <Text
            style={[pageType.body, { color: tokens.foreground, fontSize: 15, fontWeight: row.pinned ? "700" : "500", flexShrink: 1 }]}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text style={[pageType.meta, { color: tokens.mutedForeground, flexShrink: 3 }]} numberOfLines={1}>
            {row.subtitle}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            style={[pageType.body, { color: tokens.foreground, fontWeight: row.pinned ? "700" : "500" }]}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text style={[pageType.meta, { color: tokens.mutedForeground }]} numberOfLines={1}>
            {row.subtitle}
          </Text>
        </View>
      )}
    </Pressable>
  );
  return index < REVEAL_ROWS ? (
    <Reveal order={index} distance={8}>
      {body}
    </Reveal>
  ) : (
    body
  );
});

/** Grid cell (desktop "grid" mode): artwork-led tile, two text lines. */
const LibraryGridTile = React.memo(function LibraryGridTile({
  row,
  size,
  onOpen,
}: {
  row: LibraryRow;
  size: number;
  onOpen: (row: LibraryRow) => void;
}) {
  const { tokens } = useTheme();
  return (
    <PressableScale
      onPress={() => onOpen(row)}
      accessibilityRole="button"
      accessibilityLabel={row.name}
      style={{ width: size, gap: 6 }}
    >
      <ArtworkImage
        source={row.artwork}
        size={size}
        shape={row.circular ? "circle" : "rounded"}
        recyclingKey={row.key}
      />
      <Text style={[pageType.body, { color: tokens.foreground, fontSize: 15, fontWeight: "600" }]} numberOfLines={1}>
        {row.name}
      </Text>
      <Text style={[pageType.meta, { color: tokens.mutedForeground }]} numberOfLines={1}>
        {row.subtitle}
      </Text>
    </PressableScale>
  );
});

export default function LibraryScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();

  // "all" walks every artist and album row; the web defaults to playlists
  // for exactly that reason.
  const [filter, setFilter] = useState<LibraryFilter>("playlists");
  const [search, setSearch] = useState("");

  // View mode (plan 4.3, library row): list / compact / grid, persisted
  // (plan 4.5). Desktop shell only - on mobile and native the stored value
  // is ignored and the list renders exactly as shipped.
  const desktop = useDesktopShell();
  const containerWidth = useContainerWidth();
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() => readLibraryViewMode());
  const selectViewMode = useCallback((mode: LibraryViewMode) => {
    setViewMode(mode);
    writeLibraryViewMode(mode);
  }, []);
  const effectiveMode: LibraryViewMode = desktop ? viewMode : "list";
  const gridColumns = collectionGridColumns(containerWidth);
  // Grid tile size: the page gutter a side, the gap 16 between tiles.
  const gridTileSize = Math.max(
    120,
    Math.floor((containerWidth - gutter * 2 - 16 * (gridColumns - 1)) / gridColumns),
  );

  const wantsPlaylists = filter === "all" || filter === "playlists";
  const wantsArtists = filter === "all" || filter === "artists";
  const wantsAlbums = filter === "all" || filter === "albums";

  const playlistsQuery = usePlaylists({ enabled: wantsPlaylists });
  const artistsQuery = useLibraryArtists(wantsArtists);
  const albumsQuery = useLibraryAlbums(wantsAlbums);

  const labels = useMemo(
    () => ({
      playlistKind: t("components.music.Sidebar.playlistKind"),
      artistKind: t("components.music.Sidebar.artistKind"),
      albumKind: t("components.music.Sidebar.albumKind"),
      synced: t("components.music.Sidebar.synced"),
    }),
    [t],
  );

  const rows = useMemo(
    () =>
      buildLibraryRows(
        filter,
        {
          playlists: playlistsQuery.data ?? [],
          artists: artistsQuery.data ?? [],
          albums: albumsQuery.data ?? [],
        },
        search,
        labels,
      ),
    [filter, playlistsQuery.data, artistsQuery.data, albumsQuery.data, search, labels],
  );

  // Pinned ABOVE whatever the pills chose (owner request 2026-08-14): the
  // quick links are gone - Liked Songs lives at the top of the list itself,
  // on Tudo and Playlists only (a playlist pinned amid artists or albums is
  // noise, owner feedback 2026-08-14), hidden by a non-matching search.
  const likedRow = useMemo(
    () => likedLibraryRow(t("components.music.Sidebar.liked"), labels.playlistKind),
    [t, labels],
  );
  const wantsLiked = filter === "all" || filter === "playlists";
  const data = useMemo(
    () => (wantsLiked && rowMatchesSearch(likedRow, search) ? [likedRow, ...rows] : rows),
    [wantsLiked, likedRow, rows, search],
  );

  // Only the queries feeding the active pill count; the disabled ones sit
  // pending forever and would pin the spinner.
  const isLoading =
    (wantsPlaylists && playlistsQuery.isLoading) ||
    (wantsArtists && artistsQuery.isLoading) ||
    (wantsAlbums && albumsQuery.isLoading);
  const isError =
    (wantsPlaylists && playlistsQuery.isError) ||
    (wantsArtists && artistsQuery.isError) ||
    (wantsAlbums && albumsQuery.isError);

  const pills = [
    { key: "all", label: t("components.music.Sidebar.filterAll") },
    { key: "playlists", label: t("components.music.Sidebar.filterPlaylists") },
    { key: "artists", label: t("components.music.Sidebar.filterArtists") },
    { key: "albums", label: t("components.music.Sidebar.filterAlbums") },
  ];

  const retry = useCallback(() => {
    if (wantsPlaylists) void playlistsQuery.refetch();
    if (wantsArtists) void artistsQuery.refetch();
    if (wantsAlbums) void albumsQuery.refetch();
  }, [wantsPlaylists, wantsArtists, wantsAlbums, playlistsQuery, artistsQuery, albumsQuery]);

  const changeFilter = useCallback((key: string) => setFilter(key as LibraryFilter), []);

  const openRow = useCallback((row: LibraryRow) => router.push(row.route), [router]);

  const header = (
    // No inset here: the list's contentContainer already carries the safe
    // area, and stacking both is where the huge blank band above the title
    // came from.
    <View style={{ gap: 12, paddingBottom: 8 }}>
      {/* Avatar a esquerda, titulo a direita: o TabHeader partilhado
          (pedido do dono 2026-08-18) - antes era o contrario. */}
      <TabHeader title={t("components.music.Sidebar.libraryTitle")} />

      {/* Desktop pairs the view-mode cluster WITH the pills - the controls
          sit on the line of the rows they reshape, not up by the title. */}
      {desktop ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingRight: gutter }}>
          <FilterPills
            pills={pills}
            activeKey={filter}
            onChange={changeFilter}
            contentPaddingHorizontal={gutter}
            style={{ flex: 1, minWidth: 0 }}
          />
          <GhostIconButton
            icon="list"
            onPress={() => selectViewMode("list")}
            active={effectiveMode === "list"}
            accessibilityLabel={t("native.desktop.viewList")}
          />
          <GhostIconButton
            icon="rows-3"
            onPress={() => selectViewMode("compact")}
            active={effectiveMode === "compact"}
            accessibilityLabel={t("native.desktop.viewCompact")}
          />
          <GhostIconButton
            icon="layout-grid"
            onPress={() => selectViewMode("grid")}
            active={effectiveMode === "grid"}
            accessibilityLabel={t("native.desktop.viewGrid")}
          />
        </View>
      ) : (
        <FilterPills
          pills={pills}
          activeKey={filter}
          onChange={changeFilter}
          contentPaddingHorizontal={gutter}
        />
      )}

      <FilterField
        value={search}
        onChangeText={setSearch}
        placeholder={t("native.library.filterPlaceholder")}
        clearLabel={t("components.music.MusicSearchInput.clear")}
        style={{ marginBottom: 4 }}
      />
    </View>
  );

  const empty = isLoading ? (
    <PageState
      loading
      onRetry={retry}
      skeleton={<ListSkeleton rows={10} round={filter === "artists"} />}
    />
  ) : isError ? (
    <ErrorState onRetry={retry} />
  ) : (
    <EmptyState
      icon={search.trim() ? "search" : "library"}
      text={
        search.trim()
          ? t("native.library.noFilterMatches")
          : t("components.music.Sidebar.emptyLibrary")
      }
    />
  );

  const isGrid = effectiveMode === "grid";
  const compact = effectiveMode === "compact";
  const rowHeight = compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT;

  // Rows are fixed height, so the list never has to measure them; the
  // header is measured once and offsets every row.
  const headerHeight = useRef(0);
  const getItemLayout = useCallback(
    (_data: ArrayLike<LibraryRow> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: headerHeight.current + rowHeight * index,
      index,
    }),
    [rowHeight],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: LibraryRow; index: number }) =>
      isGrid ? (
        <LibraryGridTile row={item} size={gridTileSize} onOpen={openRow} />
      ) : (
        <LibraryRowView row={item} index={index} compact={compact} onOpen={openRow} />
      ),
    [isGrid, gridTileSize, compact, openRow],
  );

  return (
    <FlatList
      // numColumns cannot change on a live FlatList; the key remounts the
      // list when the mode (or the column count under it) changes. Only the
      // desktop toggle can cause that - mobile is always the single column.
      key={isGrid ? `grid-${gridColumns}` : effectiveMode}
      style={{ flex: 1, backgroundColor: tokens.background }}
      data={data}
      keyExtractor={keyExtractor}
      numColumns={isGrid ? gridColumns : 1}
      columnWrapperStyle={
        isGrid ? { gap: 16, paddingHorizontal: gutter, marginBottom: 20 } : undefined
      }
      renderItem={renderItem}
      getItemLayout={isGrid ? undefined : getItemLayout}
      ListHeaderComponent={
        <View onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}>{header}</View>
      }
      ListEmptyComponent={empty}
      // The pinned row keeps the list technically non-empty: whenever only
      // Liked Songs rendered, the loading / error / empty message follows it
      // as the footer instead.
      ListFooterComponent={data.length > 0 && rows.length === 0 ? empty : null}
      initialNumToRender={16}
      maxToRenderPerBatch={WINDOW_SIZE}
      windowSize={11}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding + 24 }}
    />
  );
}

const keyExtractor = (row: LibraryRow): string => row.key;
