/**
 * Songs management (FR-96). Infinite /songs at 500/page (the hard server cap),
 * the next pages loading on by themselves; ONE search box over the loaded
 * pages (title, artist or album) plus quality/format in a sheet, with a
 * PARALLEL server title search folded in so a track the infinite query has
 * not reached yet still shows up; virtualized fixed-height rows; multi-select
 * bulk delete with confirm; the per-song edit dialog (multipart artwork + the always-present
 * `featured_artist_names[]` key) and the FR-126 metadata modifier row.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { guardedQueryFn } from "@/api/queries/common";
import { listSongsPage, useDeleteSong, useSongsInfinite } from "@/api/queries/songs";
import { keys } from "@/api/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/auth/guard";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration } from "@/domain/format";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, BottomSheet, ConfirmDialog, Icon } from "@/ui";
import { FadeIn } from "@/ui/motion";
import { ListSkeleton, PageState, PageTitle, useGutter } from "@/ui/page";
import { MetadataModifierDialog } from "./metadataModifier";
import { SongEditDialog } from "./SongEditDialog";
import {
  activeSheetFilters,
  codecOptions,
  filterSongs,
  hasTextFilter,
  mergeLookups,
  EMPTY_SONG_FILTERS,
  type SongFilterState,
} from "./songsFilters";
import {
  SearchField,
  SettingsRow,
  SettingsSection,
  useApiErrorMessage,
  useDebounced,
} from "./ui";

const TABLE_KEY = "components.music.Settings.SongsTable";
const DELETE_KEY = `${TABLE_KEY}.DeleteSongDialog`;

/** Fixed row height: lets the list skip measuring (getItemLayout). */
const ROW_HEIGHT = 64;

/** Pages loaded without being asked (500 each). */
const AUTO_PAGES = 6;

/** Server-side match beyond the loaded pages (web useSongLibrarySearch).
 *  The one search box asks the server by TITLE; artist and album matches
 *  come from the loaded pages, which load on by themselves. */
const SONG_SEARCH_LIMIT = 100;

const useSongLibrarySearch = (term: string) => {
  const authReady = useAuthReady();
  const debounced = useDebounced(term.trim(), 300);
  const enabled = debounced.length > 1;
  const filters = { title: debounced, album: "", limit: SONG_SEARCH_LIMIT };
  const key = keys.songs.list(filters);

  const query = useQuery<Song[]>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listSongsPage({ search: { title: debounced }, page: 1, pageSize: SONG_SEARCH_LIMIT }),
    ),
    enabled: authReady && enabled,
    // Server matches stay usable while the term is still being narrowed.
    staleTime: 60 * 1000,
  });

  return { lookups: query.data ?? [], isSearching: enabled && query.isFetching };
};

const SongManagementRow = React.memo(
  ({
    song,
    selected,
    selecting,
    gutter,
    onPress,
    onLongPress,
  }: {
    song: Song;
    selected: boolean;
    selecting: boolean;
    gutter: number;
    onPress: (song: Song) => void;
    onLongPress: (song: Song) => void;
  }) => {
    const { tokens } = useTheme();
    const t = useT();
    const artwork = useMemo(() => songArtworkSource(song), [song]);
    const meta = [formatArtists(song) || t(`${TABLE_KEY}.columns.unknownArtist`), song.album]
      .filter(Boolean)
      .join(" · ");

    return (
      <Pressable
        onPress={() => onPress(song)}
        onLongPress={() => onLongPress(song)}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={song.title}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
          height: ROW_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: gutter,
          backgroundColor:
            pressed || selected ? tokens.secondary : hovered ? tokens.accent : "transparent",
        })}
      >
        {selecting ? (
          <FadeIn duration={160}>
            <Icon
              name={selected ? "circle-check" : "plus"}
              size={20}
              color={selected ? tokens.foreground : tokens.mutedForeground}
            />
          </FadeIn>
        ) : null}
        <ArtworkImage source={artwork} songId={song.id} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 16, fontWeight: "500" }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            {meta}
          </Text>
        </View>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, fontVariant: ["tabular-nums"] }}>
          {formatDuration(song.duration)}
        </Text>
      </Pressable>
    );
  },
);
SongManagementRow.displayName = "SongManagementRow";

/** Uma opção que se liga e desliga (filtros): linha simples com um visto. */
const ToggleCheckRow = ({
  label,
  checked,
  onPress,
  first,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  first: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <SettingsRow
      first={first}
      label={label}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      trailing={
        <View style={{ width: 20, height: 20 }}>
          {checked ? <Icon name="check" size={20} color={tokens.foreground} /> : null}
        </View>
      }
    />
  );
};

const FiltersSheet = ({
  visible,
  onClose,
  filters,
  onChange,
  codecs,
}: {
  visible: boolean;
  onClose: () => void;
  filters: SongFilterState;
  onChange: (next: SongFilterState) => void;
  codecs: string[];
}) => {
  const t = useT();
  const { tokens } = useTheme();

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1, color: tokens.foreground, fontSize: 20, fontWeight: "700" }}>
            {t("native.settings.songs.filtersTitle")}
          </Text>
          {activeSheetFilters(filters) > 0 ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => onChange({ ...filters, qualities: [], codecs: [] })}
            >
              <Text style={{ color: tokens.mutedForeground, fontSize: 14, fontWeight: "600" }}>
                {t("native.settings.songs.filtersClear")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <SettingsSection title={t(`${TABLE_KEY}.filterByQuality`)}>
          {(["lossless", "lossy"] as const).map((value, index) => (
            <ToggleCheckRow
              key={value}
              first={index === 0}
              label={
                value === "lossless"
                  ? t(`${TABLE_KEY}.qualityLossless`)
                  : t(`${TABLE_KEY}.qualityLossy`)
              }
              checked={filters.qualities.includes(value)}
              onPress={() => onChange({ ...filters, qualities: toggle(filters.qualities, value) })}
            />
          ))}
        </SettingsSection>
        {codecs.length > 0 ? (
          <SettingsSection title={t(`${TABLE_KEY}.filterByCodec`)}>
            {codecs.map((value, index) => (
              <ToggleCheckRow
                key={value}
                first={index === 0}
                label={value.toUpperCase()}
                checked={filters.codecs.includes(value)}
                onPress={() => onChange({ ...filters, codecs: toggle(filters.codecs, value) })}
              />
            ))}
          </SettingsSection>
        ) : null}
      </View>
    </BottomSheet>
  );
};

/** Acção de texto pequena (Filtros, Seleccionar, Apagar). */
const TextAction = ({
  label,
  onPress,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) => {
  const { tokens, ink } = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={10} onPress={onPress}>
      {({ pressed }) => (
        <Text
          style={{
            color: destructive ? ink.destructive : tokens.foreground,
            fontSize: 15,
            fontWeight: "600",
            opacity: pressed ? 0.6 : 1,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
};

export default function SongsManagementScreen() {
  const t = useT();
  const { tokens, ink } = useTheme();
  const gutter = useGutter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const errorMessage = useApiErrorMessage();

  const songsQuery = useSongsInfinite();
  const deleteSong = useDeleteSong();

  const [filters, setFilters] = useState<SongFilterState>(EMPTY_SONG_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Song | null>(null);
  const [toolOpen, setToolOpen] = useState(false);

  const query = filters.query ?? "";
  const { lookups, isSearching } = useSongLibrarySearch(query);

  const pages = useMemo(() => songsQuery.data?.pages.flat() ?? [], [songsQuery.data]);
  const loadedSongs = useMemo(() => mergeLookups(pages, lookups), [pages, lookups]);
  const filtered = useMemo(() => filterSongs(loadedSongs, filters), [loadedSongs, filters]);
  const codecs = useMemo(() => codecOptions(loadedSongs), [loadedSongs]);
  const filtering = hasTextFilter(filters) || activeSheetFilters(filters) > 0;

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = songsQuery;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // The rest of the library loads on by itself (500 per page; the owner has
  // ~1500, so two more requests): the count is the real one and a filter
  // sees every song instead of "scroll to find it". Past AUTO_PAGES only a
  // filter or the end of the list asks for more.
  const pageCount = songsQuery.data?.pages.length ?? 0;
  useEffect(() => {
    if (filtering || pageCount < AUTO_PAGES) loadMore();
  }, [filtering, pageCount, loadMore]);

  const selectedSongs = useMemo(
    () => filtered.filter((song) => selection.has(song.id)),
    [filtered, selection],
  );

  const toggleSelection = useCallback((id: SongId) => {
    haptics.select();
    setSelection((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setSelecting(false);
  }, []);

  const runBulkDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // Sequential: the server has no bulk route and each delete cascades.
      for (const song of selectedSongs) {
        await deleteSong.mutateAsync(song.id);
      }
      haptics.success();
      clearSelection();
      setConfirmDelete(false);
    } catch (error) {
      haptics.error();
      setConfirmDelete(false);
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const onRowPress = useCallback(
    (song: Song) => (selecting ? toggleSelection(song.id) : setEditing(song)),
    [selecting, toggleSelection],
  );
  const onRowLongPress = useCallback(
    (song: Song) => {
      haptics.press();
      setSelecting(true);
      toggleSelection(song.id);
    },
    [toggleSelection],
  );

  const renderRow = useCallback(
    ({ item }: { item: Song }) => (
      <SongManagementRow
        song={item}
        selected={selection.has(item.id)}
        selecting={selecting}
        gutter={gutter}
        onPress={onRowPress}
        onLongPress={onRowLongPress}
      />
    ),
    [selecting, selection, gutter, onRowPress, onRowLongPress],
  );

  const title = (
    <PageTitle style={{ paddingHorizontal: gutter }}>
      {t("components.music.Settings.SongsPage.title")}
    </PageTitle>
  );

  if (songsQuery.isLoading || songsQuery.error) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: topPadding, gap: 20 }}>
        {title}
        <PageState
          loading={songsQuery.isLoading}
          error={songsQuery.error}
          onRetry={() => void songsQuery.refetch()}
          skeleton={<ListSkeleton rows={10} />}
        />
      </View>
    );
  }

  const countLabel = t("native.downloads.songCount", {
    count: filtering ? filtered.length : pages.length,
  });
  const sheetCount = activeSheetFilters(filters);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(song) => String(song.id)}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={16}
        windowSize={11}
        removeClippedSubviews
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 12 }}>
            {title}
            <View style={{ paddingHorizontal: gutter, gap: 14 }}>
              <SearchField
                value={query}
                onChangeText={(value) => setFilters({ ...filters, query: value })}
                placeholder={t("native.settings.songs.search")}
              />
              {/* Uma linha: a contagem à esquerda, as duas acções à direita.
                  Com algo seleccionado, a linha passa a ser a da selecção. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 20, minHeight: 24 }}>
                {selectedSongs.length > 0 ? (
                  <>
                    <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
                      {t(`${TABLE_KEY}.songsSelected`, { count: selectedSongs.length })}
                    </Text>
                    <TextAction label={t("native.settings.songs.selectionCancel")} onPress={clearSelection} />
                    <TextAction
                      destructive
                      label={t(`${TABLE_KEY}.deleteSelected`)}
                      onPress={() => setConfirmDelete(true)}
                    />
                  </>
                ) : (
                  <>
                    <Text
                      style={{
                        flex: 1,
                        color: tokens.mutedForeground,
                        fontSize: 14,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {countLabel}
                      {isSearching || hasNextPage ? " …" : ""}
                    </Text>
                    <TextAction
                      label={
                        sheetCount > 0
                          ? `${t("native.settings.songs.filtersTitle")} (${sheetCount})`
                          : t("native.settings.songs.filtersTitle")
                      }
                      onPress={() => setFiltersOpen(true)}
                    />
                    <TextAction
                      label={
                        selecting
                          ? t("native.settings.songs.selectionCancel")
                          : t("native.settings.songs.selectionStart")
                      }
                      onPress={() => (selecting ? clearSelection() : setSelecting(true))}
                    />
                  </>
                )}
              </View>
              {deleteError ? (
                <Text style={{ color: ink.destructive, fontSize: 14 }}>{deleteError}</Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <PageState
            loading={false}
            empty
            emptyIcon="music"
            emptyText={t(`${TABLE_KEY}.noMatchesInLibrary`)}
          />
        }
        ListFooterComponent={
          <View style={{ gap: 28, paddingTop: 8 }}>
            {isFetchingNextPage ? <ListSkeleton rows={3} /> : null}
            {/* A ferramenta das etiquetas não mexe na biblioteca: em baixo,
                em "Avançado", fora do caminho. */}
            <SettingsSection
              title={t("native.settings.advanced")}
              style={{ marginHorizontal: gutter, marginTop: 20 }}
            >
              <SettingsRow
                first
                label={t("native.settings.songs.metadataToolTitle")}
                detail={t("native.settings.songs.metadataToolDescription")}
                onPress={() => setToolOpen(true)}
              />
            </SettingsSection>
          </View>
        }
      />

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        codecs={codecs}
      />

      {editing ? (
        <SongEditDialog song={editing} visible onClose={() => setEditing(null)} />
      ) : null}

      <MetadataModifierDialog visible={toolOpen} onClose={() => setToolOpen(false)} />

      <ConfirmDialog
        visible={confirmDelete}
        title={
          selectedSongs.length === 1
            ? t(`${DELETE_KEY}.areYouSure`)
            : t(`${DELETE_KEY}.areYouSureMultiple`, { count: selectedSongs.length })
        }
        message={
          selectedSongs.length === 1
            ? t(`${DELETE_KEY}.areYouSureDescription`, { title: selectedSongs[0]?.title ?? "" })
            : t(`${DELETE_KEY}.areYouSureDescriptionMultiple`, { count: selectedSongs.length })
        }
        confirmLabel={t(`${DELETE_KEY}.delete`)}
        destructive
        pending={deleting}
        onConfirm={() => void runBulkDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
