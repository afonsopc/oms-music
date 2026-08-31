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
 *  - long-press drag on the grip reorders through
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
import { foregroundWash } from "@/ui/uiTheme";

const QP = "components.music.QueuePanel";
const K = "native.player";
const NP = "components.music.NowPlayingSheet";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/**
 * Pill de modo (idioma Apple Music, pedido do dono 2026-08-14): shuffle e
 * repeat sairam da linha de transporte do player e vivem AQUI, no topo da
 * fila, como capsulas translucidas - o sitio exacto onde o AM as tem.
 */
const ModePill = ({
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
  const { tokens, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        height: 44,
        borderRadius: 22,
        backgroundColor: active
          ? foregroundWash(scheme, 0.28)
          : foregroundWash(scheme, 0.1),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon
        name={icon}
        size={18}
        color={active ? tokens.foreground : tokens.mutedForeground}
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
          gap: 10,
          paddingHorizontal: 20,
          paddingBottom: 14,
        }}
      >
        <ModePill
          icon="shuffle"
          active={shuffle}
          label={t(`${NP}.shuffle`)}
          onPress={() => getTransport().setShuffle(!shuffle)}
        />
        <ModePill
          icon={loopMode === "one" ? "repeat-1" : "repeat"}
          active={loopMode !== "none"}
          label={t(`${NP}.loop`)}
          onPress={() => getTransport().setLoopMode(nextLoopMode(loopMode))}
        />
      </View>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 1,
          textTransform: "uppercase",
          paddingHorizontal: 20,
          paddingBottom: 6,
        }}
      >
        {t(`${K}.upNext`)}
      </Text>
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
