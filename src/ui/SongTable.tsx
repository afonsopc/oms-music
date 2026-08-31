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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Rampa do degrau com que uma vizinha abre espaço: desliza, não salta. */
const SLIDE_PX = 10;

/** Faixa nas bordas da lista onde um arrasto começa a puxar a lista. */
const AUTO_SCROLL_EDGE = 64;
/** Passo por tick e intervalo entre ticks: 12px/16ms ≈ 750px por segundo. */
const AUTO_SCROLL_STEP = 12;
const AUTO_SCROLL_MS = 16;

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

  /**
   * Auto-scroll: a lista anda sozinha quando a linha arrastada chega às
   * bordas. Sem isto, uma linha só se podia mover dentro do que cabe no ecrã,
   * o que numa playlist grande não é reordenar coisa nenhuma.
   *
   * Vive TODO em refs: durante o gesto não pode haver uma volta ao React por
   * frame. As contas são em coordenadas da lista, sem nada de página - a
   * linha arrastada está em `header + index * altura - offset + dy`, e as três
   * medidas vêm do onLayout/onScroll/onContentSizeChange do próprio FlatList.
   *
   * `dragY` (e portanto o alvo) conta o dedo MAIS o que a lista rolou, que é
   * o deslocamento no CONTEÚDO; no ecrã a linha continua a seguir o dedo,
   * porque o conteúdo inteiro andou o mesmo.
   */
  const scrollOffset = useRef(0);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const headerHeight = useRef(0);
  const travel = useRef({ dy: 0, base: 0, scrolled: 0, index: -1 });
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const innerListRef = useRef<FlatList<Song> | null>(null);
  const rowHeight = songRowHeight(compact);

  // A ref da lista. O auto-scroll precisa de um handle, mas a ref que o ecrã
  // manda é PROP, e numa prop não se escreve (react-hooks/immutability, e com
  // razão: não é nossa). Então uma ref-objecto vinda de fora fica ELA na
  // FlatList e o handle lê-se dela; uma ref-função é chamada, que é o que uma
  // função aceita, e aí o handle fica na nossa.
  const externalListRef = listRef && typeof listRef !== "function" ? listRef : null;
  const attachList = useCallback(
    (node: FlatList<Song> | null) => {
      innerListRef.current = node;
      if (typeof listRef === "function") listRef(node);
    },
    [listRef, innerListRef],
  );
  const scrollListTo = useCallback(
    (offset: number) => {
      const external = listRef && typeof listRef !== "function" ? listRef.current : null;
      (external ?? innerListRef.current)?.scrollToOffset({ offset, animated: false });
    },
    [listRef, innerListRef],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current == null) return;
    clearInterval(autoScroll.current);
    autoScroll.current = null;
  }, []);

  const startAutoScroll = useCallback(() => {
    stopAutoScroll();
    autoScroll.current = setInterval(() => {
      const { dy, base, scrolled, index } = travel.current;
      const viewport = viewportHeight.current;
      const maxOffset = Math.max(0, contentHeight.current - viewport);
      if (index < 0 || viewport <= 0 || maxOffset <= 0) return;

      // Onde a linha está NO ECRÃ. O que já rolou não entra: o dedo não se
      // mexe quando a lista anda por baixo dele.
      const top = headerHeight.current + index * rowHeight - base + dy;
      const step =
        top < AUTO_SCROLL_EDGE
          ? -AUTO_SCROLL_STEP
          : top + rowHeight > viewport - AUTO_SCROLL_EDGE
            ? AUTO_SCROLL_STEP
            : 0;
      if (step === 0) return;

      const next = Math.max(0, Math.min(maxOffset, base + scrolled + step));
      const applied = next - (base + scrolled);
      // No topo ou no fim não há mais para onde puxar, e o tick cala-se.
      if (applied === 0) return;
      travel.current.scrolled = scrolled + applied;
      scrollListTo(next);
      dragY.setValue(dy + travel.current.scrolled);
    }, AUTO_SCROLL_MS);
  }, [dragY, rowHeight, scrollListTo, stopAutoScroll, travel]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

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
      travel.current = { dy: 0, base: scrollOffset.current, scrolled: 0, index };
      setDrag({ index });
      startAutoScroll();
    },
    [dragY, travel, scrollOffset, startAutoScroll],
  );

  const moveDrag = useCallback(
    (dy: number) => {
      travel.current.dy = dy;
      dragY.setValue(dy + travel.current.scrolled);
    },
    [dragY, travel],
  );

  const endDrag = useCallback(
    (index: number, dy: number) => {
      stopAutoScroll();
      setDrag(null);
      dragY.setValue(0);
      // O que a linha andou é o dedo MAIS o que a lista rolou por baixo dela.
      const to = clampTarget(index, dy + travel.current.scrolled);
      travel.current = { dy: 0, base: 0, scrolled: 0, index: -1 };
      if (to !== index) onReorder?.(index, to);
    },
    [clampTarget, dragY, onReorder, stopAutoScroll, travel],
  );

  /**
   * O estilo de cada linha durante um arrasto: a arrastada segue o dedo, as
   * VIZINHAS abrem espaço. Sem elas a abrir, o arrasto não tinha leitura
   * nenhuma - a linha passava por cima das outras sem nada dizer onde ia
   * cair, e acertar no sítio era à sorte.
   *
   * Sai tudo do MESMO `dragY`, por interpolação: durante o gesto não há uma
   * única volta ao React. Cada degrau cai exactamente onde `clampTarget`
   * muda de alvo (meia linha), portanto o que se vê é o que fica; a rampa de
   * SLIDE_PX à volta do degrau é só para a vizinha deslizar em vez de saltar.
   */
  const rowDragStyle = useCallback(
    (index: number) => {
      if (drag == null) return null;
      if (drag.index === index) {
        return {
          transform: [{ translateY: dragY }],
          zIndex: 10,
          elevation: 4,
          backgroundColor: tokens.card,
          borderRadius: 8,
        };
      }
      const height = songRowHeight(compact);
      const below = index > drag.index;
      // Meia linha antes do centro da vizinha: é aí que o alvo passa a ser o
      // lugar dela, e é aí que ela tem de sair da frente.
      const step = (index - drag.index + (below ? -0.5 : 0.5)) * height;
      return {
        transform: [
          {
            translateY: dragY.interpolate({
              inputRange: [step - SLIDE_PX, step + SLIDE_PX],
              outputRange: below ? [0, -height] : [height, 0],
              extrapolate: "clamp" as const,
            }),
          },
        ],
      };
    },
    [drag, dragY, compact, tokens.card],
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
      return <Animated.View style={rowDragStyle(index)}>{row}</Animated.View>;
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
      rowDragStyle,
      compact,
      tokens.mutedForeground,
      t,
    ],
  );

  const keyExtractor = useCallback((item: Song, index: number) => `${item.id}:${index}`, []);

  // O offset é sempre seguido (o auto-scroll precisa de saber onde a lista
  // estava quando se agarrou na linha); o callback do ecrã, quando existe,
  // continua a ser servido do mesmo evento.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffset.current = e.nativeEvent.contentOffset.y;
      onScrollOffset?.(scrollOffset.current);
    },
    [onScrollOffset, scrollOffset],
  );

  return (
    <FlatList
      ref={externalListRef ?? attachList}
      onLayout={(e) => {
        viewportHeight.current = e.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
      }}
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
      scrollEventThrottle={reorderEnabled ? 16 : 32}
      ListHeaderComponent={
        // Medido porque o auto-scroll precisa de saber onde começa a
        // primeira linha: o cabeçalho (hero + barra de acções) faz parte do
        // conteúdo que rola.
        <View
          onLayout={(e) => {
            headerHeight.current = e.nativeEvent.layout.height;
          }}
        >
          {header}
          {showHeader && songs.length > 0 ? (
            <SongTableHeader
              columns={columns}
              hasPlays={!!playCounts && Object.keys(playCounts).length > 0}
              reorder={reorderEnabled}
              hasLike={likeColumn}
            />
          ) : null}
        </View>
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
