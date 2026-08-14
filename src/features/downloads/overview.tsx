/**
 * Downloads OVERVIEW (owner request 2026-08-14): the Transferências tab's
 * replacement lives in Settings. No endless song list - the library screens
 * already show what is downloaded in place. This page answers the questions
 * a list cannot: how much space, how many songs/files, what is in flight,
 * which playlists are kept offline (with per-playlist song counts), and how
 * big the 7-day play-cache tier is. Plus the GO OFFLINE switch, which forces
 * the offline resolvers regardless of what NetInfo says.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { formatBytes } from "./format";
import { getMusicStorage, type MusicStorage } from "@/api/endpoints/musicStorage";
import {
  downloadedPlaylists,
  listDownloadedSongs,
  listInFlight,
  playCacheUsage,
  storageUsage,
} from "@/downloads/manager";
import {
  isManualOffline,
  setManualOffline,
  subscribeManualOffline,
} from "@/downloads/offlineLibrary";
import { getStatusVersion, subscribeDownloadStatus } from "@/downloads/status";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { switchColors } from "@/theme/switchColors";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";
import { ArtworkImage, Icon } from "@/ui";

const useDownloadVersion = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

const useManualOffline = (): boolean =>
  useSyncExternalStore(subscribeManualOffline, isManualOffline, isManualOffline);

const StatCard = ({ label, value }: { label: string; value: string }) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "30%",
        backgroundColor: tokens.secondary,
        borderRadius: RADIUS,
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 4,
      }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>{label}</Text>
    </View>
  );
};

/** Horizontal proportion bar: downloads vs play cache vs free headroom. */
const StorageBar = ({
  downloadsBytes,
  cacheBytes,
}: {
  downloadsBytes: number;
  cacheBytes: number;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  const total = Math.max(1, downloadsBytes + cacheBytes);
  const seg = (bytes: number): number => Math.max(2, Math.round((bytes / total) * 100));
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          backgroundColor: tokens.secondary,
        }}
      >
        <View style={{ width: `${seg(downloadsBytes)}%`, backgroundColor: tokens.primary }} />
        <View
          style={{ width: `${seg(cacheBytes)}%`, backgroundColor: tokens.mutedForeground }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.primary }} />
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.downloadsOverview.legendDownloads", { size: formatBytes(downloadsBytes) })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.mutedForeground }}
          />
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.downloadsOverview.legendCache", { size: formatBytes(cacheBytes) })}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default function DownloadsOverviewScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const topPadding = useContentTopPadding();
  const bottomPadding = useContentBottomPadding();
  const version = useDownloadVersion();
  const manualOffline = useManualOffline();

  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);
  const [serverStorage, setServerStorage] = useState<MusicStorage | null>(null);

  // Server-side music storage (the ActiveStorage quota): one best-effort
  // fetch per mount; the row simply stays hidden when it cannot answer.
  useEffect(() => {
    let cancelled = false;
    void getMusicStorage()
      .then((result) => {
        if (!cancelled) setServerStorage(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Synchronous reads keyed by the coarse status version (FR-82 discipline).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const songs = useMemo(() => listDownloadedSongs(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inFlight = useMemo(() => listInFlight(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playlists = useMemo(() => downloadedPlaylists(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => playCacheUsage(), [version]);

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

  const downloadsBytes = Math.max(0, (usage?.bytes ?? 0) - cache.bytes);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{
        paddingTop: topPadding,
        paddingBottom: bottomPadding + 24,
        paddingHorizontal: 24,
        gap: 20,
      }}
    >
      <Text style={[typeScale.sectionHeader, { color: tokens.foreground }]}>
        {t("native.shell.tabDownloads")}
      </Text>

      {/* GO OFFLINE: force the offline resolvers even with a live network -
          the Spotify semantics (test your downloads, save data). */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: tokens.secondary,
          borderRadius: RADIUS,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Icon name="cloud-check" size={20} color={tokens.foreground} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
            {t("native.downloadsOverview.goOffline")}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 2 }}>
            {t("native.downloadsOverview.goOfflineHint")}
          </Text>
        </View>
        <Switch
          value={manualOffline}
          onValueChange={setManualOffline}
          {...switchColors(tokens)}
        />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <StatCard
          label={t("native.downloadsOverview.songs")}
          value={String(songs.length)}
        />
        <StatCard
          label={t("native.downloadsOverview.files")}
          value={String(usage?.files ?? 0)}
        />
        <StatCard
          label={t("native.downloadsOverview.storage")}
          value={usage ? formatBytes(usage.bytes) : "-"}
        />
      </View>

      <StorageBar downloadsBytes={downloadsBytes} cacheBytes={cache.bytes} />

      {serverStorage ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: tokens.secondary,
            borderRadius: RADIUS,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Icon name="cloud-check" size={20} color={tokens.foreground} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
              {t("native.downloadsOverview.serverStorage")}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 2 }}>
              {t("native.downloadsOverview.serverStorageUsed", {
                used: formatBytes(serverStorage.used_bytes),
                limit: formatBytes(serverStorage.limit_bytes),
              })}
            </Text>
          </View>
        </View>
      ) : null}

      {inFlight.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
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
                backgroundColor: tokens.secondary,
                borderRadius: RADIUS,
                paddingHorizontal: 12,
                paddingVertical: 10,
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

      <View style={{ gap: 8 }}>
        <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
          {t("native.downloadsOverview.offlinePlaylists")}
        </Text>
        {playlists.length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t("native.downloadsOverview.noOfflinePlaylists")}
          </Text>
        ) : (
          playlists.map((playlist) => (
            <View
              key={playlist.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}
            >
              <ArtworkImage
                source={
                  playlist.source_external_id === "liked"
                    ? { kind: "likedHeart" }
                    : playlist.artwork_fs_node_id
                      ? { kind: "node", nodeId: playlist.artwork_fs_node_id }
                      : { kind: "placeholder" }
                }
                size={40}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{ color: tokens.foreground, fontSize: 14, fontWeight: "500" }}
                  numberOfLines={1}
                >
                  {playlist.name}
                </Text>
                <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                  {t("native.downloads.songCount", { count: playlist.song_count })}
                </Text>
              </View>
              <Icon name="cloud-check" size={18} color={tokens.primary} />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
