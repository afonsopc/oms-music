/**
 * Library tab (FR-35). Pills gate the queries (picking "Playlists" must
 * not pull the artist and album lists too), everything pages at the 500
 * ceiling, the filter box narrows locally, and the list is WINDOWED: a
 * 500-artist library must not fire 500 artwork requests on mount, so rows
 * render 40 at a time through a FlatList instead of all at once.
 */
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import {
  readLibraryViewMode,
  writeLibraryViewMode,
} from "@/features/shell/desktop/layoutPrefs";
import { HeaderAvatar } from "@/features/shell/HeaderAvatar";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { typeScale } from "@/theme/typography";
import {
  ArtworkImage,
  collectionGridColumns,
  EmptyState,
  ErrorState,
  FilterPills,
  GhostIconButton,
  Icon,
  useContainerWidth,
  useDesktopShell,
  type LibraryViewMode,
} from "@/ui";
import { LIBRARY_ITEM_LIMIT, useLibraryAlbums, useLibraryArtists } from "./queries";
import {
  buildLibraryRows,
  likedLibraryRow,
  rowMatchesSearch,
  type LibraryFilter,
  type LibraryRow,
} from "./rows";

/** Rows rendered per window batch (web LIBRARY_PAGE_SIZE). */
const WINDOW_SIZE = 40;

const LibraryRowView = ({
  row,
  compact = false,
  onPress,
}: {
  row: LibraryRow;
  /** Desktop compact mode (plan 4.3): no artwork, one line, denser. */
  compact?: boolean;
  onPress: () => void;
}) => {
  const { tokens, ink } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.name}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 24,
        paddingVertical: compact ? 6 : 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {compact ? null : (
        <ArtworkImage
          source={row.artwork}
          size={44}
          shape={row.circular ? "circle" : "rounded"}
          recyclingKey={row.key}
        />
      )}
      {compact ? (
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text
            style={{
              color: tokens.foreground,
              fontSize: 14,
              fontWeight: row.pinned ? "700" : "500",
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          {/* Spotify-sync marker: emerald, per the design language. */}
          {row.system ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: ink.sync,
                alignSelf: "center",
              }}
            />
          ) : null}
          <Text
            style={{ color: tokens.mutedForeground, fontSize: 12, flexShrink: 3 }}
            numberOfLines={1}
          >
            {row.subtitle}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
              style={{
                color: tokens.foreground,
                fontSize: 14,
                fontWeight: row.pinned ? "700" : "500",
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              {row.name}
            </Text>
            {/* Spotify-sync marker: emerald, per the design language. */}
            {row.system ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: ink.sync,
                }}
              />
            ) : null}
          </View>
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
            {row.subtitle}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

/** Grid cell (desktop "grid" mode): artwork-led tile, two text lines. */
const LibraryGridTile = ({
  row,
  size,
  onPress,
}: {
  row: LibraryRow;
  size: number;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.name}
      style={({ pressed }) => ({
        width: size,
        gap: 6,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ArtworkImage
        source={row.artwork}
        size={size}
        shape={row.circular ? "circle" : "rounded"}
        recyclingKey={row.key}
      />
      <Text
        style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}
        numberOfLines={1}
      >
        {row.name}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
        {row.subtitle}
      </Text>
    </Pressable>
  );
};

export default function LibraryScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
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
  // Grid tile size: horizontal padding is 24 a side, the gap 16 per gutter.
  const gridTileSize = Math.max(
    120,
    Math.floor((containerWidth - 48 - 16 * (gridColumns - 1)) / gridColumns),
  );

  const wantsPlaylists = filter === "all" || filter === "playlists";
  const wantsArtists = filter === "all" || filter === "artists";
  const wantsAlbums = filter === "all" || filter === "albums";

  const playlistsQuery = usePlaylists({
    page: `1:${LIBRARY_ITEM_LIMIT}`,
    enabled: wantsPlaylists,
  });
  const artistsQuery = useLibraryArtists(wantsArtists);
  const albumsQuery = useLibraryAlbums(wantsAlbums);

  const labels = useMemo(
    () => ({
      playlistKind: t("components.music.Sidebar.playlistKind"),
      artistKind: t("components.music.Sidebar.artistKind"),
      albumKind: t("components.music.Sidebar.albumKind"),
      spotify: t("components.music.Sidebar.syncedFromSpotify"),
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

  const header = (
    // No inset here: the list's contentContainer already carries the safe
    // area, and stacking both is where the huge blank band above the title
    // came from.
    <View style={{ gap: 16, paddingBottom: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 24,
        }}
      >
        <Text style={[typeScale.sectionHeader, { color: tokens.foreground, flex: 1 }]}>
          {t("components.music.Sidebar.libraryTitle")}
        </Text>
        {/* O avatar a direita do titulo, onde o Spotify o tem. E a porta
            para /account desde que a barra de tabs passou a ser a do sistema
            e deixou de poder carrega-lo (2026-08-16). */}
        <HeaderAvatar />
      </View>

      {/* Desktop pairs the view-mode cluster WITH the pills - the controls
          sit on the line of the rows they reshape, not up by the title.
          Mobile keeps the bare strip, byte-identical to what shipped. */}
      {desktop ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 24 }}>
          <FilterPills
            pills={pills}
            activeKey={filter}
            onChange={(key) => setFilter(key as LibraryFilter)}
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
          onChange={(key) => setFilter(key as LibraryFilter)}
        />
      )}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginHorizontal: 24,
          paddingHorizontal: 12,
          height: 38,
          borderRadius: 999,
          backgroundColor: tokens.secondary,
        }}
      >
        <Icon name="search" size={15} color={tokens.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("native.library.filterPlaceholder")}
          placeholderTextColor={tokens.mutedForeground}
          autoCorrect={false}
          accessibilityLabel={t("components.music.Sidebar.searchPlaceholder")}
          style={{ flex: 1, color: tokens.foreground, fontSize: 14 }}
        />
        {search.length > 0 ? (
          <Pressable
            onPress={() => setSearch("")}
            accessibilityRole="button"
            accessibilityLabel={t("components.music.MusicSearchInput.clear")}
            hitSlop={8}
          >
            <Icon name="x" size={14} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const empty = isLoading ? (
    <Text
      style={{ color: tokens.mutedForeground, fontSize: 13, paddingHorizontal: 24 }}
    >
      {t("components.music.Sidebar.loading")}
    </Text>
  ) : isError ? (
    <ErrorState text={t("components.music.Artists.errorLoadingArtists")} />
  ) : (
    <EmptyState
      icon="library"
      text={
        search.trim()
          ? t("native.library.noFilterMatches")
          : t("components.music.Sidebar.emptyLibrary")
      }
    />
  );

  const isGrid = effectiveMode === "grid";

  return (
    <FlatList
      // numColumns cannot change on a live FlatList; the key remounts the
      // list when the mode (or the column count under it) changes. Only the
      // desktop toggle can cause that - mobile is always the single column.
      key={isGrid ? `grid-${gridColumns}` : effectiveMode}
      style={{ flex: 1, backgroundColor: tokens.background }}
      data={data}
      keyExtractor={(row) => row.key}
      numColumns={isGrid ? gridColumns : 1}
      columnWrapperStyle={
        isGrid ? { gap: 16, paddingHorizontal: 24, marginBottom: 16 } : undefined
      }
      renderItem={({ item }) =>
        isGrid ? (
          <LibraryGridTile
            row={item}
            size={gridTileSize}
            onPress={() => router.push(item.route)}
          />
        ) : (
          <LibraryRowView
            row={item}
            compact={effectiveMode === "compact"}
            onPress={() => router.push(item.route)}
          />
        )
      }
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      // The pinned row keeps the list technically non-empty: whenever only
      // Liked Songs rendered, the loading / error / empty message follows it
      // as the footer instead.
      ListFooterComponent={data.length > 0 && rows.length === 0 ? empty : null}
      initialNumToRender={WINDOW_SIZE}
      maxToRenderPerBatch={WINDOW_SIZE}
      windowSize={11}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding + 24 }}
    />
  );
}
