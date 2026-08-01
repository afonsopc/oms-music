/**
 * Windowed song table (web SongTable parity). Renders as a FlatList so a
 * whole collection screen can be one virtualized list: pass the hero +
 * ActionBar as `header`. Windowing: 40 rows initially, incremental batches
 * (FR: no artwork request storm on 500-row libraries).
 *
 * Drag-to-reorder (no dnd library installed): fixed-height rows + a grip
 * handle with a PanResponder; on release the visual index delta maps to
 * `onReorder(fromVisible, toVisible)`. Only enabled when the surface says
 * so (playlists refuse reorder until fully loaded, FR-50).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Animated,
  FlatList,
  PanResponder,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useDownloadStatusVersion } from "./downloadStatus";
import { Icon } from "./icons";
import {
  DEFAULT_SONG_COLUMNS,
  SONG_ROW_HEIGHT,
  SongRow,
  type SongRowColumn,
} from "./SongRow";
import type { SongMenuItem } from "@/contracts/songMenu";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface SongTableProps {
  songs: Song[];
  columns?: SongRowColumn[];
  /** ISO date per row for the addedAt column. */
  addedAtFor?: (song: Song, index: number) => string | undefined;
  /** Per-song play counts (Popular list). Enables the Plays column. */
  playCounts?: Readonly<Record<number, number>>;
  likedIds?: ReadonlySet<number>;
  currentSongId?: number | null;
  isPlaying?: boolean;
  /** Deep-link song highlight by title (FR-44). */
  highlightTitle?: string | null;
  showHeader?: boolean;
  surface?: string;
  onPlay: (song: Song, index: number) => void;
  extraActionsFor?: (song: Song, index: number) => SongMenuItem[] | undefined;
  /** Enables drag handles; refuse by omitting (partially loaded lists). */
  onReorder?: (fromVisible: number, toVisible: number) => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  emptyComponent?: React.ReactElement | null;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  /** Scroll offset callback (StickyTitle wiring). */
  onScrollOffset?: (offsetY: number) => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Bottom padding so the MiniPlayer never covers list tails (FR-16). */
  contentBottomPadding?: number;
  listRef?: React.Ref<FlatList<Song>>;
  scrollEnabled?: boolean;
  testID?: string;
}

const TableHeader = ({
  columns,
  hasPlays,
  reorder,
}: {
  columns: SongRowColumn[];
  hasPlays: boolean;
  reorder: boolean;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const isNarrow = width < 768;
  const has = (c: SongRowColumn) =>
    columns.includes(c) && !(isNarrow && (c === "album" || c === "addedAt"));
  const cellStyle = { color: tokens.mutedForeground, fontSize: 12 } as const;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: tokens.border,
      }}
    >
      {has("index") ? (
        <Text style={[cellStyle, { width: 28, textAlign: "center" }]}>#</Text>
      ) : null}
      {has("title") ? (
        <Text style={[cellStyle, { flex: 1.5 }]}>{t("components.music.SongTable.title")}</Text>
      ) : null}
      {has("album") ? (
        <Text style={[cellStyle, { flex: 1 }]}>{t("components.music.SongTable.album")}</Text>
      ) : null}
      {has("addedAt") ? (
        <Text style={[cellStyle, { flex: 0.6 }]}>{t("components.music.SongTable.addedAt")}</Text>
      ) : null}
      {hasPlays ? (
        <Text style={[cellStyle, { width: 48, textAlign: "right" }]}>
          {t("components.music.SongTable.plays")}
        </Text>
      ) : null}
      {has("duration") ? (
        <View style={{ width: 44, alignItems: "flex-end" }}>
          <Icon name="clock" size={14} color={tokens.mutedForeground} />
        </View>
      ) : null}
      <View style={{ width: reorder ? 56 : 32 }} />
    </View>
  );
};

interface DragState {
  index: number;
}

export const SongTable = ({
  songs,
  columns = DEFAULT_SONG_COLUMNS,
  addedAtFor,
  playCounts,
  likedIds,
  currentSongId,
  isPlaying = false,
  highlightTitle,
  showHeader = false,
  surface = "row",
  onPlay,
  extraActionsFor,
  onReorder,
  header,
  footer,
  emptyComponent,
  onEndReached,
  onEndReachedThreshold = 0.5,
  onScrollOffset,
  contentContainerStyle,
  contentBottomPadding = 0,
  listRef,
  scrollEnabled = true,
  testID,
}: SongTableProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const downloadVersion = useDownloadStatusVersion();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));
  const reorderEnabled = !!onReorder;

  const clampTarget = useCallback(
    (from: number, dy: number): number => {
      const delta = Math.round(dy / SONG_ROW_HEIGHT);
      return Math.max(0, Math.min(songs.length - 1, from + delta));
    },
    [songs.length],
  );

  const startDrag = useCallback(
    (index: number) => {
      dragY.setValue(0);
      setDrag({ index });
    },
    [dragY],
  );

  const moveDrag = useCallback(
    (dy: number) => {
      dragY.setValue(dy);
    },
    [dragY],
  );

  const endDrag = useCallback(
    (index: number, dy: number) => {
      setDrag(null);
      dragY.setValue(0);
      const to = clampTarget(index, dy);
      if (to !== index) onReorder?.(index, to);
    },
    [clampTarget, dragY, onReorder],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Song; index: number }) => {
      const row = (
        <SongRow
          song={item}
          index={index}
          columns={columns}
          addedAt={addedAtFor?.(item, index)}
          playCount={playCounts ? (playCounts[item.id] ?? 0) : undefined}
          liked={likedIds?.has(item.id) ?? false}
          isCurrent={currentSongId != null && currentSongId === item.id}
          isPlaying={isPlaying}
          highlighted={!!highlightTitle && highlightTitle === item.title}
          surface={surface}
          extraActions={extraActionsFor?.(item, index)}
          onPlay={() => onPlay(item, index)}
          downloadVersion={downloadVersion}
          dragHandle={
            reorderEnabled ? (
              <DragHandle
                index={index}
                color={tokens.mutedForeground}
                onStart={startDrag}
                onMove={moveDrag}
                onEnd={endDrag}
                label={t("components.music.SongTable.drag")}
              />
            ) : undefined
          }
        />
      );
      if (drag?.index === index) {
        return (
          <Animated.View
            style={{
              transform: [{ translateY: dragY }],
              zIndex: 10,
              elevation: 4,
              backgroundColor: tokens.card,
              borderRadius: 8,
            }}
          >
            {row}
          </Animated.View>
        );
      }
      return row;
    },
    [
      columns,
      addedAtFor,
      playCounts,
      likedIds,
      currentSongId,
      isPlaying,
      highlightTitle,
      surface,
      extraActionsFor,
      onPlay,
      downloadVersion,
      reorderEnabled,
      startDrag,
      moveDrag,
      endDrag,
      drag,
      dragY,
      tokens.card,
      tokens.mutedForeground,
      t,
    ],
  );

  const keyExtractor = useCallback((item: Song, index: number) => `${item.id}:${index}`, []);

  const handleScroll = useMemo(
    () =>
      onScrollOffset
        ? (e: NativeSyntheticEvent<NativeScrollEvent>) =>
            onScrollOffset(e.nativeEvent.contentOffset.y)
        : undefined,
    [onScrollOffset],
  );

  return (
    <FlatList
      ref={listRef}
      testID={testID}
      data={songs}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      extraData={downloadVersion}
      initialNumToRender={40}
      maxToRenderPerBatch={40}
      windowSize={11}
      removeClippedSubviews
      scrollEnabled={scrollEnabled && drag == null}
      onEndReached={onEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      onScroll={handleScroll}
      scrollEventThrottle={handleScroll ? 32 : undefined}
      ListHeaderComponent={
        <>
          {header}
          {showHeader && songs.length > 0 ? (
            <TableHeader
              columns={columns}
              hasPlays={!!playCounts && Object.keys(playCounts).length > 0}
              reorder={reorderEnabled}
            />
          ) : null}
        </>
      }
      ListFooterComponent={footer ?? undefined}
      ListEmptyComponent={emptyComponent ?? undefined}
      contentContainerStyle={[
        { paddingBottom: contentBottomPadding },
        contentContainerStyle,
      ]}
    />
  );
};

interface DragHandleProps {
  index: number;
  color: string;
  label: string;
  onStart: (index: number) => void;
  onMove: (dy: number) => void;
  onEnd: (index: number, dy: number) => void;
}

const DragHandle = ({ index, color, label, onStart, onMove, onEnd }: DragHandleProps) => {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => onStart(index),
        onPanResponderMove: (_evt, gesture) => onMove(gesture.dy),
        onPanResponderRelease: (_evt, gesture) => onEnd(index, gesture.dy),
        onPanResponderTerminate: (_evt, gesture) => onEnd(index, gesture.dy),
      }),
    [index, onStart, onMove, onEnd],
  );
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityLabel={label}
      style={{ width: 24, height: 32, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name="grip-vertical" size={16} color={color} />
    </View>
  );
};
