/**
 * Queue (FR-72/73), page 1 of the (player) pager.
 *
 * The list is the VISIBLE order (`queueOrder.map(i => queue[i])`) and every
 * callback speaks visible indices, exactly like the queue quartet ops:
 *
 *  - tapping the current row toggles playback, any other row jumps to it;
 *  - the active row can never be removed (queueOps refuses it anyway, this
 *    just keeps the affordance honest);
 *  - jam proposals carry their proposer attribution (SongRow renders the
 *    `@handle` suffix) and cannot be removed either, since the host queue
 *    owns them;
 *  - drag on the grip (every row has one) reorders through
 *    `reorderQueue(fromVisible, toVisible)`.
 *
 * The quartet is read through `remote/mirror`: while controlling another
 * device this list IS the remote queue, which is also the list the visible
 * indices in every callback refer to server-side (FR-109).
 */
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useLikedIds } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import type { SongMenuItem } from "@/contracts/songMenu";
import type { LoopMode } from "@/domain/playback";
import { isDjClip, type Song } from "@/domain/song";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { EmptyState, Icon, SongTable, type IconName } from "@/ui";
import { DjQueue } from "@/features/dj/DjQueue";
import { useDjStation } from "@/features/dj/station";
import { pageType } from "@/ui/page";
import { haptics } from "@/lib/haptics";

const QP = "components.music.QueuePanel";
const K = "native.player";
const NP = "components.music.NowPlayingSheet";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/**
 * Baralhar e repetir no topo da fila, ao lado de "A seguir": ícones simples
 * (redesenho 2026-11-04; eram cápsulas). Aceso = branco com um ponto por
 * baixo; apagado = cinzento.
 */
const QueueToggle = ({
  icon,
  active,
  label,
  onPress,
}: {
  icon: IconName;
  active: boolean;
  label: string;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={20} color={active ? tokens.foreground : tokens.mutedForeground} />
      <View
        style={{
          position: "absolute",
          bottom: 4,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: active ? tokens.foreground : "transparent",
        }}
      />
    </Pressable>
  );
};

export default function QueueBody() {
  const t = useT();
  const { tokens } = useTheme();
  const queue = usePlaybackView((v) => v.queue);
  const queueOrder = usePlaybackView((v) => v.queueOrder);
  const queueIndex = usePlaybackView((v) => v.queueIndex);
  const playing = usePlaybackView((v) => v.playing);
  const currentSong = usePlaybackView((v) => v.song);
  const shuffle = usePlaybackView((v) => v.shuffle);
  const loopMode = usePlaybackView((v) => v.loopMode);
  const djActive = useDjStation((state) => state.active);
  const likedIds = useLikedIds();

  // Visible order: what the user sees IS the play order under shuffle.
  const visible = useMemo<Song[]>(
    () =>
      queueOrder
        .map((backingIndex) => queue[backingIndex])
        .filter((song): song is Song => song != null),
    [queue, queueOrder],
  );

  const likedSet = useMemo(() => new Set(likedIds.data ?? []), [likedIds.data]);

  const extraActionsFor = (song: Song, visibleIndex: number): SongMenuItem[] => [
    {
      id: "removeFromQueue",
      labelKey: `${QP}.remove`,
      icon: "x",
      disabled: visibleIndex === queueIndex || !!song.jam_song || isDjClip(song),
      onPress: () => getTransport().removeFromQueue(visibleIndex),
    },
  ];

  if (visible.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <EmptyState icon="list-music" text={t(`${QP}.empty`)} />
      </View>
    );
  }

  // Com a estacao no ar a fila e dele, e uma fila dele nao se arrasta nem
  // se baralha: a vista propria vive em features/dj/DjQueue.
  if (djActive) return <DjQueue />;

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 20,
          paddingRight: 12,
          paddingBottom: 4,
        }}
      >
        <Text
          accessibilityRole="header"
          style={[pageType.section, { color: tokens.foreground, flex: 1, fontSize: 18 }]}
        >
          {t(`${K}.upNext`)}
        </Text>
        <QueueToggle
          icon="shuffle"
          active={shuffle}
          label={t(`${NP}.shuffle`)}
          onPress={() => getTransport().setShuffle(!shuffle)}
        />
        <QueueToggle
          icon={loopMode === "one" ? "repeat-1" : "repeat"}
          active={loopMode !== "none"}
          label={t(`${NP}.loop`)}
          onPress={() => getTransport().setLoopMode(nextLoopMode(loopMode))}
        />
      </View>
      <SongTable
        songs={visible}
        columns={["index", "title", "duration"]}
        likedIds={likedSet}
        currentSongId={currentSong?.id ?? null}
        isPlaying={playing}
        surface="queue"
        showHeader={false}
        onPlay={(_song, visibleIndex) => {
          if (visibleIndex === queueIndex) {
            getTransport().toggle();
            return;
          }
          getTransport().setQueueIndex(visibleIndex);
        }}
        extraActionsFor={extraActionsFor}
        onReorder={(fromVisible, toVisible) => getTransport().reorderQueue(fromVisible, toVisible)}
        contentBottomPadding={24}
      />
    </View>
  );
}
