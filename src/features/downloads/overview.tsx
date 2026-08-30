/**
 * Downloads OVERVIEW (owner request 2026-08-14): the Transferências tab's
 * replacement lives in Settings. No endless song list - the library screens
 * already show what is downloaded in place. This page answers the questions
 * a list cannot: how much space, how many songs/files, what is in flight,
 * which playlists are kept offline (with per-playlist song counts), and how
 * big the 7-day play-cache tier is. Plus the GO OFFLINE switch, which forces
 * the offline resolvers regardless of what NetInfo says.
 */
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { formatBytes } from "./format";
import { readPredictiveTier } from "./predictiveTier";
import type { MusicStorageUsage } from "@omelhorsite/sdk";
import { oms } from "@/api/oms";
import { getDownloadsSurface } from "@/downloads/surface";
import {
  isManualOffline,
  setManualOffline,
  subscribeManualOffline,
} from "@/downloads/offlineLibrary";
import {
  getProgressVersion,
  getStatusVersion,
  subscribeDownloadProgress,
  subscribeDownloadStatus,
} from "@/downloads/status";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { switchColors } from "@/theme/switchColors";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";
import { ArtworkImage, Icon } from "@/ui";

const useDownloadVersion = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

/** The in-flight list's percent bars ride the ~1 Hz progress channel. */
const useDownloadProgressVersion = (): number =>
  useSyncExternalStore(subscribeDownloadProgress, getProgressVersion, getProgressVersion);

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
  const progressVersion = useDownloadProgressVersion();
  const manualOffline = useManualOffline();

  const [serverStorage, setServerStorage] = useState<MusicStorageUsage | null>(null);

  // Server-side music storage (the ActiveStorage quota): one best-effort
  // fetch per mount; the row simply stays hidden when it cannot answer.
  useEffect(() => {
    let cancelled = false;
    void oms().music.social.storage.get()
      .then((result) => {
        if (!cancelled) setServerStorage(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Synchronous reads keyed by the coarse status version, which since the
  // 2026-08-14 freeze report bumps on TRANSITIONS only. Byte totals come from
  // SQL SUMs - the old disk walk stat()ed thousands of files on the JS thread
  // per bump. They go through DownloadsSurface rather than the native manager
  // so this screen renders real numbers on the Tauri shell too, and its
  // permanent zeros on a plain browser tab (plano "uma so app", F1).
  //
  // `purged` is its own dep because emptying an already-idle tier changes no
  // status the coarse channel would ever report.
  const [purged, setPurged] = useState(0);
  const surface = getDownloadsSurface();
  // The surface is re-read INSIDE each memo, never captured: a platform can
  // install its real implementation after the first paint (the desktop fork
  // registers its provider synchronously but only fills it in once cache_open
  // resolves), and a captured reference would pin this screen to the inert one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const songs = useMemo(() => getDownloadsSurface().listDownloadedSongs(), [version]);
  // In-flight rows carry the percent, so they alone key on progress too.
  const inFlight = useMemo(
    () => getDownloadsSurface().listInFlight(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, progressVersion],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playlists = useMemo(() => getDownloadsSurface().downloadedPlaylists(), [version]);
  // Álbuns e artistas mantidos offline, por nome (handoff 2026-08-18): a
  // identidade é derivada dos Songs pinados, portanto a lista acompanha o
  // mesmo contador de versão que já refresca as músicas.
  const collections = useMemo(
    () => getDownloadsSurface().downloadedCollections?.() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  // The evictable tier: the play cache and the predictive tier are the SAME
  // orphan rows (no stored-song row), which is the whole point of the design -
  // one cache with two admission reasons, not two caches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tier = useMemo(() => readPredictiveTier(), [version, purged]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pinned = useMemo(() => getDownloadsSurface().pinnedUsage(), [version, purged]);

  const cache = tier.usage;
  const [freedBytes, setFreedBytes] = useState<number | null>(null);
  const onPurge = useCallback(() => {
    const run = readPredictiveTier().purge;
    if (!run) return;
    void run()
      .then((freed) => setFreedBytes(freed))
      .catch(() => undefined)
      .finally(() => setPurged((n) => n + 1));
  }, []);

  const downloadsBytes = pinned.bytes;
  const usage = {
    bytes: pinned.bytes + cache.bytes,
    files: pinned.files + cache.files,
  };

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
          the Spotify semantics (test your downloads, save data). Never on
          web: with no downloads subsystem there the flag would only empty
          the library, persist that state across reloads, and give the tab
          nothing it could possibly play (plano "uma so app", F1). */}
      {Platform.OS !== "web" ? (
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
      ) : null}

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

      {/* The evictable tier, stated plainly. It is the one number in this
          screen the user did not ask for: bytes the app fetched on its own,
          either because a song played (play cache) or because it guessed the
          song was next (predictive). Both are deleted oldest-first the moment
          the budget is exceeded, and pinned downloads are never candidates -
          so the row can offer a one-tap purge with no confirmation dialog.
          Absent where there is no local store at all (plain browser tab). */}
      {surface.available() ? (
      <View
        style={{
          backgroundColor: tokens.secondary,
          borderRadius: RADIUS,
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="cloud-check" size={20} color={tokens.foreground} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
              {t("native.downloadsOverview.cacheTitle")}
            </Text>
            {/* A budget this platform cannot compute is simply not drawn:
                "0 B de 0 B" over a cache that is really holding two gigabytes
                would be worse than saying nothing at all. */}
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 2 }}>
              {cache.files === 0
                ? t("native.downloadsOverview.cacheEmpty")
                : t("native.downloadsOverview.cacheDetail", {
                    files: cache.files,
                    size: formatBytes(cache.bytes),
                    budget: tier.budget != null ? formatBytes(tier.budget) : "-",
                  })}
            </Text>
          </View>
          {tier.purge ? (
            <Pressable
              onPress={onPurge}
              disabled={cache.files === 0}
              accessibilityRole="button"
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: RADIUS,
                backgroundColor: tokens.background,
                opacity: cache.files === 0 ? 0.4 : 1,
              }}
            >
              <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}>
                {t("native.downloadsOverview.cachePurge")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Waste instrumentation (design section 9): without the ratio there
            is no way to tell whether the prediction ladder is earning its
            bytes. Hidden until the tier has actually predicted something. */}
        {tier.waste && tier.waste.written > 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.downloadsOverview.cacheWaste", {
              written: formatBytes(tier.waste.written),
              wasted: formatBytes(tier.waste.evictedUnplayed),
              percent: Math.round(tier.waste.ratio * 100),
            })}
          </Text>
        ) : null}

        {freedBytes != null ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.downloads.cachePurged", { size: formatBytes(freedBytes) })}
          </Text>
        ) : null}
      </View>
      ) : null}

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
            {/* `limit_bytes` é null numa conta ilimitada: lê-se `unlimited`
                antes de dividir por ele (music_storage_controller.rb). */}
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 2 }}>
              {serverStorage.unlimited || serverStorage.limit_bytes === null
                ? t("native.downloadsOverview.serverStorageUnlimited", {
                    used: formatBytes(serverStorage.used_bytes),
                  })
                : t("native.downloadsOverview.serverStorageUsed", {
                    used: formatBytes(serverStorage.used_bytes),
                    limit: formatBytes(serverStorage.limit_bytes),
                  })}
            </Text>
            {/* Storage cap FR-94: quando o total local já excede a quota, os
                enfileiramentos novos são recusados (manager) - e este é o
                sítio onde esse estado se explica em vez de só recusar. */}
            {!serverStorage.unlimited &&
            serverStorage.limit_bytes !== null &&
            serverStorage.limit_bytes > 0 &&
            usage.bytes >= serverStorage.limit_bytes ? (
              <Text style={{ color: tokens.destructive, fontSize: 12, marginTop: 2 }}>
                {t("native.downloadsOverview.storageCapExceeded")}
              </Text>
            ) : null}
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
                  playlist.sourceExternalId === "liked"
                    ? { kind: "likedHeart" }
                    : playlist.artworkMediaId
                      ? { kind: "node", nodeId: playlist.artworkMediaId }
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
                  {t("native.downloads.songCount", { count: playlist.songCount })}
                </Text>
              </View>
              <Icon name="cloud-check" size={18} color={tokens.primary} />
            </View>
          ))
        )}
      </View>

      {/* Álbuns e artistas offline (handoff 2026-08-18). Sem estado vazio
          próprio: ao contrário das playlists (que têm o seu toggle em todo o
          lado), esta secção só existe quando há alguma coisa para listar. */}
      {collections.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
            {t("native.downloadsOverview.offlineAlbumsArtists")}
          </Text>
          {collections.map((row) => (
            <View
              key={row.key}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}
            >
              <ArtworkImage
                source={
                  row.artworkMediaId
                    ? { kind: "node", nodeId: row.artworkMediaId }
                    : { kind: "placeholder" }
                }
                size={40}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{ color: tokens.foreground, fontSize: 14, fontWeight: "500" }}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 12 }}
                  numberOfLines={1}
                >
                  {row.kind === "album" && row.subtitle
                    ? row.subtitle
                    : t("native.downloads.songCount", { count: row.songCount })}
                </Text>
              </View>
              <Icon name="cloud-check" size={18} color={tokens.primary} />
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
