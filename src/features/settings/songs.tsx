/**
 * Songs management (FR-96). Infinite /songs at 500/page (the hard server cap)
 * with a load-more button and a `<loaded>+` total; client-side filters over
 * the loaded pages (title / artist / album substring, origin, quality, codec)
 * with a PARALLEL server search folded in so a track the infinite query has
 * not reached yet still shows up; multi-select bulk delete with confirm; the
 * per-song edit dialog (multipart artwork + the always-present
 * `featured_artist_names[]` key) and the FR-126 metadata modifier row.
 */
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { listSongs } from "@/api/endpoints/songs";
import { guardedQueryFn } from "@/api/queries/common";
import { useDeleteSong, useSongsInfinite } from "@/api/queries/songs";
import { keys } from "@/api/queryKeys";
import { pageModifier } from "@/api/params";
import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/auth/guard";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration } from "@/domain/format";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, BottomSheet, ConfirmDialog, EmptyState, ErrorState, Icon } from "@/ui";
import { MetadataModifierDialog } from "./metadataModifier";
import { SongEditDialog } from "./SongEditDialog";
import {
  codecOptions,
  filterSongs,
  hasTextFilter,
  mergeLookups,
  originOptions,
  EMPTY_SONG_FILTERS,
  type SongFilterState,
} from "./songsFilters";
import {
  GhostButton,
  PrimaryButton,
  SearchField,
  SettingsSection,
  SettingsRow,
  ToggleChip,
  useApiErrorMessage,
  useDebounced,
} from "./ui";

const TABLE_KEY = "components.music.Settings.SongsTable";
const DELETE_KEY = `${TABLE_KEY}.DeleteSongDialog`;

/** Server-side match beyond the loaded pages (web useSongLibrarySearch). */
const SONG_SEARCH_LIMIT = 100;

const useSongLibrarySearch = (title: string, album: string) => {
  const authReady = useAuthReady();
  const debouncedTitle = useDebounced(title.trim(), 300);
  const debouncedAlbum = useDebounced(album.trim(), 300);
  const enabled = debouncedTitle.length > 1 || debouncedAlbum.length > 1;
  const filters = { title: debouncedTitle, album: debouncedAlbum, limit: SONG_SEARCH_LIMIT };
  const key = keys.songs.list(filters);

  const query = useQuery<Song[]>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listSongs({
        search: {
          ...(debouncedTitle ? { title: debouncedTitle } : {}),
          ...(debouncedAlbum ? { album: debouncedAlbum } : {}),
        },
        modifiers: { page: pageModifier(1, SONG_SEARCH_LIMIT) },
      }),
    ),
    enabled: authReady && enabled,
    // Server matches stay usable while the term is still being narrowed.
    staleTime: 60 * 1000,
  });

  return {
    lookups: query.data ?? [],
    isSearching: enabled && query.isFetching,
    hasServerAnswer: enabled && query.isSuccess,
  };
};

const SongManagementRow = React.memo(
  ({
    song,
    selected,
    selecting,
    onPress,
    onLongPress,
  }: {
    song: Song;
    selected: boolean;
    selecting: boolean;
    onPress: () => void;
    onLongPress: () => void;
  }) => {
    const { tokens } = useTheme();
    const t = useT();
    const artwork = useMemo(() => songArtworkSource(song), [song]);
    const stems = !!song.vocals_fs_node_id && !!song.instrumental_fs_node_id;

    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: selected ? tokens.secondary : "transparent",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {selecting ? (
          <Icon
            name={selected ? "circle-check" : "plus"}
            size={18}
            color={selected ? tokens.primary : tokens.mutedForeground}
          />
        ) : null}
        <ArtworkImage source={artwork} songId={song.id} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {formatArtists(song) || t(`${TABLE_KEY}.columns.unknownArtist`)}
            {song.album ? ` - ${song.album}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <Text
            style={{
              color: tokens.mutedForeground,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatDuration(song.duration)}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {song.audio_lossless ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 10, fontWeight: "700" }}>
                {t(`${TABLE_KEY}.columns.lossless`)}
              </Text>
            ) : null}
            {stems ? <Icon name="audio-waveform" size={13} color={tokens.mutedForeground} /> : null}
          </View>
        </View>
      </Pressable>
    );
  },
);
SongManagementRow.displayName = "SongManagementRow";

const FilterGroup = ({
  label,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor?: (value: string) => string;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.settings.songs.noFilterOptions")}
          </Text>
        ) : null}
        {options.map((option) => (
          <ToggleChip
            key={option}
            label={labelFor ? labelFor(option) : option.toUpperCase()}
            active={selected.includes(option)}
            onPress={() => onToggle(option)}
          />
        ))}
      </View>
    </View>
  );
};

const FiltersSheet = ({
  visible,
  onClose,
  filters,
  onChange,
  origins,
  codecs,
}: {
  visible: boolean;
  onClose: () => void;
  filters: SongFilterState;
  onChange: (next: SongFilterState) => void;
  origins: string[];
  codecs: string[];
}) => {
  const t = useT();
  const { tokens } = useTheme();

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 18 }}>
        <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
          {t("native.settings.songs.filtersTitle")}
        </Text>
        <FilterGroup
          label={t(`${TABLE_KEY}.filterByOrigin`)}
          options={origins}
          selected={filters.origins}
          onToggle={(value) => onChange({ ...filters, origins: toggle(filters.origins, value) })}
          labelFor={(value) => value}
        />
        <FilterGroup
          label={t(`${TABLE_KEY}.filterByQuality`)}
          options={["lossless", "lossy"]}
          selected={filters.qualities}
          onToggle={(value) =>
            onChange({ ...filters, qualities: toggle(filters.qualities, value) })
          }
          labelFor={(value) =>
            value === "lossless" ? t(`${TABLE_KEY}.qualityLossless`) : t(`${TABLE_KEY}.qualityLossy`)
          }
        />
        <FilterGroup
          label={t(`${TABLE_KEY}.filterByCodec`)}
          options={codecs}
          selected={filters.codecs}
          onToggle={(value) => onChange({ ...filters, codecs: toggle(filters.codecs, value) })}
        />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <GhostButton
              label={t("native.settings.songs.filtersClear")}
              onPress={() =>
                onChange({ ...filters, origins: [], qualities: [], codecs: [] })
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton label={t("native.common.ok")} onPress={onClose} />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
};

export default function SongsManagementScreen() {
  const t = useT();
  const { tokens, ink } = useTheme();
  const bottomPadding = useContentBottomPadding();
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

  const { lookups, isSearching, hasServerAnswer } = useSongLibrarySearch(
    filters.title,
    filters.album,
  );

  const pages = useMemo(() => songsQuery.data?.pages.flat() ?? [], [songsQuery.data]);
  const loadedSongs = useMemo(() => mergeLookups(pages, lookups), [pages, lookups]);
  const filtered = useMemo(() => filterSongs(loadedSongs, filters), [loadedSongs, filters]);
  const origins = useMemo(() => originOptions(loadedSongs), [loadedSongs]);
  const codecs = useMemo(() => codecOptions(loadedSongs), [loadedSongs]);

  const selectedSongs = useMemo(
    () => filtered.filter((song) => selection.has(song.id)),
    [filtered, selection],
  );

  const toggleSelection = useCallback((id: SongId) => {
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
      clearSelection();
      setConfirmDelete(false);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const renderRow = useCallback(
    ({ item }: { item: Song }) => (
      <SongManagementRow
        song={item}
        selected={selection.has(item.id)}
        selecting={selecting}
        onPress={() => (selecting ? toggleSelection(item.id) : setEditing(item))}
        onLongPress={() => {
          setSelecting(true);
          toggleSelection(item.id);
        }}
      />
    ),
    [selecting, selection, toggleSelection],
  );

  if (songsQuery.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <ActivityIndicator color={tokens.mutedForeground} />
        <Text style={{ color: tokens.mutedForeground }}>{t(`${TABLE_KEY}.loading`)}</Text>
      </View>
    );
  }

  if (songsQuery.error) {
    return (
      <ErrorState
        text={t(`${TABLE_KEY}.errorLoadingSongs`)}
        onRetry={() => void songsQuery.refetch()}
      />
    );
  }

  const loadedPageCount = pages.length;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(song) => String(song.id)}
        renderItem={renderRow}
        initialNumToRender={20}
        windowSize={11}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}>
              {t("components.music.Settings.SongsPage.title")}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, flex: 1 }}>
                {t(`${TABLE_KEY}.totalSongs`)}{" "}
                <Text style={{ color: tokens.foreground, fontWeight: "700" }}>
                  {loadedPageCount}
                  {songsQuery.hasNextPage ? "+" : ""}
                </Text>
              </Text>
              {songsQuery.hasNextPage ? (
                <GhostButton
                  label={t(`${TABLE_KEY}.loadMore`)}
                  compact
                  disabled={songsQuery.isFetchingNextPage}
                  onPress={() => void songsQuery.fetchNextPage()}
                />
              ) : null}
            </View>

            {hasTextFilter(filters) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                  {t(`${TABLE_KEY}.filteredSongs`)}{" "}
                  <Text style={{ color: tokens.foreground, fontWeight: "700" }}>
                    {filtered.length}
                  </Text>
                </Text>
                {isSearching ? <ActivityIndicator size="small" color={tokens.mutedForeground} /> : null}
                {!isSearching && hasServerAnswer && filtered.length === 0 ? (
                  <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                    {t(`${TABLE_KEY}.noMatchesInLibrary`)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <SearchField
              value={filters.title}
              onChangeText={(value) => setFilters({ ...filters, title: value })}
              placeholder={t(`${TABLE_KEY}.filterByTitle`)}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SearchField
                value={filters.artist}
                onChangeText={(value) => setFilters({ ...filters, artist: value })}
                placeholder={t(`${TABLE_KEY}.filterByArtist`)}
                style={{ flex: 1 }}
              />
              <SearchField
                value={filters.album}
                onChangeText={(value) => setFilters({ ...filters, album: value })}
                placeholder={t(`${TABLE_KEY}.filterByAlbum`)}
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <GhostButton
                label={t("native.settings.songs.filtersTitle")}
                compact
                onPress={() => setFiltersOpen(true)}
              />
              <GhostButton
                label={
                  selecting
                    ? t("native.settings.songs.selectionCancel")
                    : t("native.settings.songs.selectionStart")
                }
                compact
                onPress={() => (selecting ? clearSelection() : setSelecting(true))}
              />
            </View>

            {selectedSongs.length > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  borderRadius: RADIUS,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  backgroundColor: tokens.card,
                  padding: 12,
                }}
              >
                <Text style={{ color: tokens.foreground, fontSize: 13, flex: 1 }}>
                  {t(`${TABLE_KEY}.songsSelected`, { count: selectedSongs.length })}
                </Text>
                <PrimaryButton
                  label={t(`${TABLE_KEY}.deleteSelected`)}
                  destructive
                  compact
                  onPress={() => setConfirmDelete(true)}
                />
              </View>
            ) : null}

            {deleteError ? (
              <Text style={{ color: ink.destructive, fontSize: 13 }}>{deleteError}</Text>
            ) : null}

            <SettingsSection title={t("native.settings.songs.toolsSection")}>
              <SettingsRow
                first
                icon="audio-waveform"
                label={t("native.settings.songs.metadataToolTitle")}
                detail={t("native.settings.songs.metadataToolDescription")}
                onPress={() => setToolOpen(true)}
              />
            </SettingsSection>
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="music" text={t(`${TABLE_KEY}.noMatchesInLibrary`)} />
        }
      />

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        origins={origins}
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
            ? t(`${DELETE_KEY}.areYouSureDescription`)
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
