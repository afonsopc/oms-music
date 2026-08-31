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
  Platform,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { songTableColumnGate, songTableDurationWidth, songTablePanelGate } from "./breakpoints";
import { useContainerWidth, useDesktopShell } from "./shellLayout";
import { Icon } from "./icons";
import {
  DEFAULT_SONG_COLUMNS,
  songRowHeight,
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
  /**
   * Like toggle for the hover heart (desktop shell, plan 4.3). Rows only
   * grow the button above 900px; below that (and on native) omitting or
   * providing this is invisible.
   */
  onToggleLike?: (song: Song, liked: boolean) => void;
  extraActionsFor?: (song: Song, index: number) => SongMenuItem[] | undefined;
  /** Enables drag handles; refuse by omitting (partially loaded lists). */
  onReorder?: (fromVisible: number, toVisible: number) => void;
  /** Compact view mode (plan 4.3): 40px artwork-less rows. */
  compact?: boolean;
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

export interface SongTableHeaderProps {
  columns: SongRowColumn[];
  hasPlays: boolean;
  reorder: boolean;
  /** Rows carry the hover heart column (desktop + onToggleLike). */
  hasLike?: boolean;
  /** Opaque background for the desktop sticky overlay copy (plan 4.3). */
  backgroundColor?: string;
}

/**
 * The column header row. Exported so the desktop collection screen can
 * render a second, absolutely-positioned copy that stays pinned under the
 * sticky title once the in-flow one scrolls off - the copy MUST be this
 * exact component or the two drift column-by-column.
 */
export const SongTableHeader = ({
  columns,
  hasPlays,
  reorder,
  hasLike = false,
  backgroundColor,
}: SongTableHeaderProps) => {
  const { tokens } = useTheme();
  const t = useT();
  // Same container-width gates as SongRow (breakpoints.ts): a header cell
  // must never appear over a column the rows dropped, so neither side keeps
  // a private ladder.
  const width = useContainerWidth();
  const desktopShell = useDesktopShell();
  const gate = songTableColumnGate(width, desktopShell);
  // Panel form drops index/duration in the rows (SongRow), so the header
  // must drop the same cells or its labels float over nothing.
  const panelGate = songTablePanelGate(width, desktopShell);
  const durationWidth = songTableDurationWidth(width, desktopShell);
  const has = (c: SongRowColumn) =>
    columns.includes(c) &&
    !(c === "album" && !gate.album) &&
    !(c === "addedAt" && !gate.addedAt) &&
    !(c === "index" && panelGate.panel) &&
    !(c === "duration" && !panelGate.duration);
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
        backgroundColor,
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
        <View
          style={
            durationWidth == null
              ? { flex: 0.5, minWidth: 44, alignItems: "flex-end" }
              : { width: durationWidth, alignItems: "flex-end" }
          }
        >
          <Icon name="clock" size={14} color={tokens.mutedForeground} />
        </View>
      ) : null}
      {/* Trailing spacer mirrors the rows' control cluster px by px:
          heart (32, desktop like column) + grip (24) + menu (32). */}
      <View style={{ width: (hasLike ? 32 : 0) + (reorder ? 24 : 0) + 32 }} />
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
  onToggleLike,
  extraActionsFor,
  onReorder,
  compact = false,
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
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));
  const reorderEnabled = !!onReorder;
  // The header's trailing spacer must mirror the rows' like column, which
  // only exists at desktop widths and OUTSIDE panel form (SongRow applies
  // the same two gates).
  const likeColumn =
    desktopShell && !!onToggleLike && !songTablePanelGate(containerWidth, desktopShell).panel;

  const clampTarget = useCallback(
    (from: number, dy: number): number => {
      const delta = Math.round(dy / songRowHeight(compact));
      return Math.max(0, Math.min(songs.length - 1, from + delta));
    },
    [songs.length, compact],
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
          compact={compact}
          onPlay={() => onPlay(item, index)}
          onToggleLike={
            onToggleLike
              ? () => onToggleLike(item, likedIds?.has(item.id) ?? false)
              : undefined
          }
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
      // TODA a linha vive dentro do mesmo Animated.View, arrastada ou não.
      // Trocar o tipo do elemento (SongRow -> Animated.View) quando o arrasto
      // começa DESMONTA a linha, e com ela a View que segura o gesto: na web,
      // ResponderSystem.removeNode() termina o responder do nó que sai do DOM,
      // e o arrasto morria no instante em que se agarrava no grip, com dy = 0
      // e portanto sem reordenar nada. A forma da árvore fica fixa; muda só o
      // estilo.
      return (
        <Animated.View
          style={
            drag?.index === index
              ? {
                  transform: [{ translateY: dragY }],
                  zIndex: 10,
                  elevation: 4,
                  backgroundColor: tokens.card,
                  borderRadius: 8,
                }
              : null
          }
        >
          {row}
        </Animated.View>
      );
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
      onToggleLike,
      reorderEnabled,
      startDrag,
      moveDrag,
      endDrag,
      drag,
      dragY,
      compact,
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
            <SongTableHeader
              columns={columns}
              hasPlays={!!playCounts && Object.keys(playCounts).length > 0}
              reorder={reorderEnabled}
              hasLike={likeColumn}
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
  const [grabbing, setGrabbing] = useState(false);
  // Um PanResponder novo traz um gestureState novo, com o dy outra vez a
  // zero: recriá-lo a meio do gesto perdia tudo o que a linha já tinha
  // andado. As quatro dependências têm de ficar ESTÁVEIS entre renders - o
  // React Compiler (app.json, experiments.reactCompiler) memoiza as arrows
  // que os ecrãs passam em `onReorder`, e é isso que as segura.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setGrabbing(true);
          onStart(index);
        },
        onPanResponderMove: (_evt, gesture) => onMove(gesture.dy),
        onPanResponderRelease: (_evt, gesture) => {
          setGrabbing(false);
          onEnd(index, gesture.dy);
        },
        onPanResponderTerminate: (_evt, gesture) => {
          setGrabbing(false);
          onEnd(index, gesture.dy);
        },
      }),
    [index, onStart, onMove, onEnd],
  );
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityLabel={label}
      style={[
        { width: 24, height: 32, alignItems: "center", justifyContent: "center" },
        // grab/grabbing are web-only CSS cursors RN's style type does not
        // know; native ignores the whole entry (plan 4.3: reorder exists
        // but shows no pointer affordance - this is the affordance).
        // userSelect e touchAction sao o resto do gesto na web: o
        // ResponderSystem termina o responder quando a pagina ganha uma
        // seleccao (selectionchange) ou quando o browser comeca um drag
        // nativo, e arrastar o rato por cima dos titulos faz exactamente
        // isso; touchAction none impede o dedo de scrollar a lista em vez
        // de arrastar a linha.
        Platform.OS === "web"
          ? ({
              cursor: grabbing ? "grabbing" : "grab",
              userSelect: "none",
              touchAction: "none",
            } as unknown as ViewStyle)
          : null,
      ]}
    >
      <Icon name="grip-vertical" size={16} color={color} />
    </View>
  );
};
