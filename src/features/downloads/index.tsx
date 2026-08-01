/**
 * Downloads screen (FR-92), the 4th tab. Header with the song count, the
 * storage bytes from a native directory walk and an offline pill; an
 * "A transferir" section with live percentages; then the downloaded list -
 * tapping a row plays the WHOLE downloaded list as the queue (web/Capacitor
 * parity), each row has a delete action, and the empty state explains where
 * downloads come from.
 *
 * Everything reads the download status map synchronously; the screen
 * subscribes ONCE to the coarse version counter (FR-82), so a burst of
 * progress events repaints this list at most ~4 Hz and never per row.
 */
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import {
  listDownloadedSongs,
  listInFlight,
  removeDownload,
  storageUsage,
} from "@/downloads/manager";
import { getDownloadNoticeHandler, setDownloadNoticeHandler } from "@/downloads/notices";
import { isOffline, subscribeOnlineState } from "@/downloads/offlineLibrary";
import { getStatusVersion, subscribeDownloadStatus } from "@/downloads/status";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, EmptyState, Icon } from "@/ui";
import { formatBytes } from "./format";

const ROW_ARTWORK = 48;
const ROW_HEIGHT = 64;
/** Same dwell as the floating notice host (boot/notices). */
const NOTICE_VISIBLE_MS = 4200;

/** Distinguishes two consecutive notices with the SAME key (timer restart). */
let noticeSeq = 0;

const useDownloadVersion = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

// Module-level so the subscribe identity is stable across renders.
const subscribeOffline = (cb: () => void): (() => void) => subscribeOnlineState(() => cb());

const useOfflineFlag = (): boolean =>
  useSyncExternalStore(subscribeOffline, isOffline, isOffline);

const DownloadedRow = ({
  song,
  onPlay,
  onRemove,
}: {
  song: Song;
  onPlay: () => void;
  onRemove: () => void;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: ROW_HEIGHT, gap: 12 }}>
      <Pressable
        onPress={onPlay}
        accessibilityRole="button"
        accessibilityLabel={song.title}
        // minWidth 0 lets long titles truncate instead of pushing the
        // delete button off the row.
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ArtworkImage
          source={songArtworkSource(song)}
          songId={song.id}
          size={ROW_ARTWORK}
          recyclingKey={String(song.id)}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
            numberOfLines={1}
          >
            {song.title}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }} numberOfLines={1}>
            {formatArtists(song) || t("components.music.SongRow.unknownArtist")}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={t("native.downloads.menuRemove")}
        hitSlop={8}
        style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1 })}
      >
        <Icon name="trash" size={18} color={tokens.mutedForeground} />
      </Pressable>
    </View>
  );
};

export default function DownloadsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const version = useDownloadVersion();
  const offline = useOfflineFlag();

  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);
  const [notice, setNotice] = useState<{ key: string; id: number } | null>(null);

  // While this screen is FOCUSED it is the surface for download notices (the
  // WiFi refusal, FR-88): they render inline here instead of as a floating
  // toast. On blur the global notice host (wired in boot) is restored, never
  // the console default - and never later than the blur, because a tab
  // screen stays mounted for the rest of the session once visited, so a
  // mount-scoped takeover would swallow every refusal raised from the album,
  // search or player surfaces afterwards.
  useFocusEffect(
    useCallback(() => {
      const previous = getDownloadNoticeHandler();
      setDownloadNoticeHandler((key) => {
        noticeSeq += 1;
        setNotice({ key, id: noticeSeq });
      });
      return () => {
        setDownloadNoticeHandler(previous);
        setNotice(null);
      };
    }, []),
  );

  // Inline notices expire like the floating ones do (a refusal from ten
  // minutes ago must not still be sitting in the header).
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // The lists are synchronous reads of the download index; `version` is the
  // coarse counter that says "something changed", so it IS the dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const songs = useMemo(() => listDownloadedSongs(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inFlight = useMemo(() => listInFlight(), [version]);

  useEffect(() => {
    let cancelled = false;
    void storageUsage()
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [version]);

  const playFrom = useCallback(
    (index: number) => {
      getTransport().setQueue(songs, index);
    },
    [songs],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <DownloadedRow
        song={item}
        onPlay={() => playFrom(index)}
        onRemove={() => {
          void removeDownload(item.id);
        }}
      />
    ),
    [playFrom],
  );

  const header = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t("native.shell.tabDownloads")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {offline ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: tokens.secondary,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Icon name="alert-circle" size={13} color={tokens.secondaryForeground} />
            <Text style={{ color: tokens.secondaryForeground, fontSize: 12 }}>
              {t("native.downloads.offlinePill")}
            </Text>
          </View>
        ) : null}
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
          {t("native.downloads.songCount", { count: songs.length })}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
          {"·"} {usage ? formatBytes(usage.bytes) : "-"}
        </Text>
        {usage && usage.files > 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {"·"} {t("native.downloads.fileCount", { count: usage.files })}
          </Text>
        ) : null}
      </View>

      {notice ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: RADIUS,
            padding: 10,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t(notice.key)}</Text>
        </View>
      ) : null}

      {inFlight.length > 0 ? (
        <View style={{ gap: 6, paddingTop: 4 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
            {t("native.downloads.inFlightTitle")}
          </Text>
          {inFlight.map((entry) => (
            <View
              key={entry.songKey}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: RADIUS,
                backgroundColor: tokens.secondary,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{ color: tokens.foreground, fontSize: 13, flex: 1, minWidth: 0 }}
                numberOfLines={1}
              >
                {entry.song?.title ?? entry.songKey}
              </Text>
              <Text
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 13,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {entry.status === "downloading"
                  ? `${Math.round(entry.progress * 100)}%`
                  : t("native.downloads.queued")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
      data={songs}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      getItemLayout={(_data, index) => ({
        length: ROW_HEIGHT,
        offset: ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={20}
      windowSize={7}
      removeClippedSubviews
      ListHeaderComponent={header}
      ListEmptyComponent={
        <EmptyState icon="download" text={t("native.downloads.emptyHint")} />
      }
    />
  );
}
