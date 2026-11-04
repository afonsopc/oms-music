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
import { Platform, Pressable, Text, View } from "react-native";
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
import {
  ProgressBar,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SwitchRow,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import type { ArtworkSource } from "@/domain/artwork";
import { ArtworkImage } from "@/ui";
import { useCountUp } from "@/ui/motion";

const useDownloadVersion = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

/** The in-flight list's percent bars ride the ~1 Hz progress channel. */
const useDownloadProgressVersion = (): number =>
  useSyncExternalStore(subscribeDownloadProgress, getProgressVersion, getProgressVersion);

const useManualOffline = (): boolean =>
  useSyncExternalStore(subscribeManualOffline, isManualOffline, isManualOffline);

/** How many in-flight rows are listed by name; the bar covers all of them. */
const IN_FLIGHT_LISTED = 5;

/**
 * Um número grande, em texto (sem caixa), com o rótulo por baixo. Conta a
 * subir na primeira vez que aparece.
 */
const BigNumber = ({ value, label }: { value: number | string; label: string }) => {
  const { tokens } = useTheme();
  const counted = useCountUp(typeof value === "number" ? value : 0);
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          color: tokens.foreground,
          fontSize: 34,
          lineHeight: 38,
          fontWeight: "800",
          letterSpacing: -1,
          fontVariant: ["tabular-nums"],
        }}
      >
        {typeof value === "number" ? counted : value}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{label}</Text>
    </View>
  );
};

const Legend = ({ color, text }: { color: string; text: string }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{text}</Text>
    </View>
  );
};

/** Horizontal proportion bar: downloads vs temporary songs. */
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
  const seg = (bytes: number): number => (bytes > 0 ? Math.max(2, Math.round((bytes / total) * 100)) : 0);
  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          backgroundColor: tokens.secondary,
        }}
      >
        <View style={{ width: `${seg(downloadsBytes)}%`, backgroundColor: tokens.foreground }} />
        <View style={{ width: `${seg(cacheBytes)}%`, backgroundColor: tokens.mutedForeground }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
        <Legend
          color={tokens.foreground}
          text={t("native.downloadsOverview.legendDownloads", { size: formatBytes(downloadsBytes) })}
        />
        <Legend
          color={tokens.mutedForeground}
          text={t("native.downloadsOverview.legendCache", { size: formatBytes(cacheBytes) })}
        />
      </View>
    </View>
  );
};

/** Uma linha de colecção offline (capa pequena, nome, contagem). */
const OfflineRow = ({
  artwork,
  title,
  meta,
  first,
}: {
  artwork: ArtworkSource;
  title: string;
  meta: string;
  first: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 60,
        paddingVertical: 8,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      <ArtworkImage source={artwork} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 16, fontWeight: "500" }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
          {meta}
        </Text>
      </View>
    </View>
  );
};

export default function DownloadsOverviewScreen() {
  const t = useT();
  const { tokens } = useTheme();
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
      .then((freed) => {
        haptics.success();
        setFreedBytes(freed);
      })
      .catch(() => undefined)
      .finally(() => setPurged((n) => n + 1));
  }, []);

  const downloadsBytes = pinned.bytes;
  const usage = {
    bytes: pinned.bytes + cache.bytes,
    files: pinned.files + cache.files,
  };

  const inFlightProgress =
    inFlight.length === 0
      ? 0
      : inFlight.reduce(
          (sum, entry) => sum + (entry.status === "downloading" ? entry.progress : 0),
          0,
        ) / inFlight.length;

  const overCap =
    serverStorage != null &&
    !serverStorage.unlimited &&
    serverStorage.limit_bytes !== null &&
    serverStorage.limit_bytes > 0 &&
    usage.bytes >= serverStorage.limit_bytes;

  return (
    <SettingsPage title={t("native.shell.tabDownloads")}>
      {/* Os números, grandes e em texto: músicas, ficheiros, espaço. */}
      <View style={{ flexDirection: "row", gap: 16 }}>
        <BigNumber value={songs.length} label={t("native.downloadsOverview.songs")} />
        <BigNumber value={usage.files} label={t("native.downloadsOverview.files")} />
        <BigNumber value={formatBytes(usage.bytes)} label={t("native.downloadsOverview.storage")} />
      </View>

      <StorageBar downloadsBytes={downloadsBytes} cacheBytes={cache.bytes} />

      {/* What is in flight: ONE bar for the whole batch (queued rows count as
          0 %), then the first few by name. */}
      {inFlight.length > 0 ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
            <Text style={{ flex: 1, color: tokens.foreground, fontSize: 16, fontWeight: "600" }}>
              {t("native.downloadsOverview.inFlight", { count: inFlight.length })}
            </Text>
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 14, fontVariant: ["tabular-nums"] }}
            >
              {`${Math.round(inFlightProgress * 100)}%`}
            </Text>
          </View>
          <ProgressBar value={inFlightProgress} />
          <View style={{ gap: 6 }}>
            {inFlight.slice(0, IN_FLIGHT_LISTED).map((entry) => (
              <View key={entry.songKey} style={{ flexDirection: "row", gap: 12 }}>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, minWidth: 0, color: tokens.mutedForeground, fontSize: 14 }}
                >
                  {entry.song?.title ?? entry.songKey}
                </Text>
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 14, fontVariant: ["tabular-nums"] }}
                >
                  {entry.status === "downloading"
                    ? `${Math.round(entry.progress * 100)}%`
                    : t("native.downloads.queued")}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* GO OFFLINE: force the offline resolvers even with a live network -
          the reference-app semantics (test your downloads, save data). Never on
          web: with no downloads subsystem there the flag would only empty
          the library, persist that state across reloads, and give the tab
          nothing it could possibly play (plano "uma so app", F1). */}
      {Platform.OS !== "web" ? (
        <SettingsSection>
          <SwitchRow
            first
            label={t("native.downloadsOverview.goOffline")}
            detail={t("native.downloadsOverview.goOfflineHint")}
            value={manualOffline}
            onValueChange={setManualOffline}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("native.downloadsOverview.offlinePlaylists")}>
        {playlists.length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 14, paddingVertical: 14 }}>
            {t("native.downloadsOverview.noOfflinePlaylists")}
          </Text>
        ) : (
          playlists.map((playlist, index) => (
            <OfflineRow
              key={playlist.id}
              first={index === 0}
              artwork={
                playlist.sourceExternalId === "liked"
                  ? { kind: "likedHeart" }
                  : playlist.artworkMediaId
                    ? { kind: "node", nodeId: playlist.artworkMediaId }
                    : { kind: "placeholder" }
              }
              title={playlist.name}
              meta={t("native.downloads.songCount", { count: playlist.songCount })}
            />
          ))
        )}
      </SettingsSection>

      {/* Álbuns e artistas offline (handoff 2026-08-18). Sem estado vazio
          próprio: esta secção só existe quando há alguma coisa para listar. */}
      {collections.length > 0 ? (
        <SettingsSection title={t("native.downloadsOverview.offlineAlbumsArtists")}>
          {collections.map((row, index) => (
            <OfflineRow
              key={row.key}
              first={index === 0}
              artwork={
                row.artworkMediaId
                  ? { kind: "node", nodeId: row.artworkMediaId }
                  : { kind: "placeholder" }
              }
              title={row.name}
              meta={
                row.kind === "album" && row.subtitle
                  ? row.subtitle
                  : t("native.downloads.songCount", { count: row.songCount })
              }
            />
          ))}
        </SettingsSection>
      ) : null}

      {/* The evictable tier and the account quota: rarely needed, so under
          "Avançado". The temporary tier is the one number here the user did
          not ask for (bytes fetched because a song played or was guessed
          next); pinned downloads are never candidates, so the purge is one
          tap with no confirmation. Absent where there is no local store. */}
      {surface.available() || serverStorage ? (
        <SettingsSection title={t("native.settings.advanced")}>
          {surface.available() ? (
            <SettingsRow
              first
              label={t("native.downloadsOverview.cacheTitle")}
              detail={[
                cache.files === 0
                  ? t("native.downloadsOverview.cacheEmpty")
                  : t("native.downloadsOverview.cacheDetail", {
                      files: cache.files,
                      size: formatBytes(cache.bytes),
                      budget: tier.budget != null ? formatBytes(tier.budget) : "-",
                    }),
                // Waste instrumentation (design section 9), only once the tier
                // has actually predicted something.
                tier.waste && tier.waste.written > 0
                  ? t("native.downloadsOverview.cacheWaste", {
                      written: formatBytes(tier.waste.written),
                      wasted: formatBytes(tier.waste.evictedUnplayed),
                      percent: Math.round(tier.waste.ratio * 100),
                    })
                  : null,
                freedBytes != null
                  ? t("native.downloads.cachePurged", { size: formatBytes(freedBytes) })
                  : null,
              ]
                .filter(Boolean)
                .join("\n")}
              trailing={
                tier.purge ? (
                  <Pressable
                    onPress={onPurge}
                    disabled={cache.files === 0}
                    accessibilityRole="button"
                    hitSlop={10}
                  >
                    {({ pressed }) => (
                      <Text
                        style={{
                          color: tokens.foreground,
                          fontSize: 14,
                          fontWeight: "600",
                          opacity: cache.files === 0 ? 0.4 : pressed ? 0.6 : 1,
                        }}
                      >
                        {t("native.downloadsOverview.cachePurge")}
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <View />
                )
              }
            />
          ) : null}
          {serverStorage ? (
            <SettingsRow
              first={!surface.available()}
              label={t("native.downloadsOverview.serverStorage")}
              // `limit_bytes` é null numa conta ilimitada: lê-se `unlimited`
              // antes de dividir por ele (music_storage_controller.rb). Storage
              // cap FR-94: past the quota new enqueues are refused (manager),
              // and this is where that state is explained.
              detail={[
                serverStorage.unlimited || serverStorage.limit_bytes === null
                  ? t("native.downloadsOverview.serverStorageUnlimited", {
                      used: formatBytes(serverStorage.used_bytes),
                    })
                  : t("native.downloadsOverview.serverStorageUsed", {
                      used: formatBytes(serverStorage.used_bytes),
                      limit: formatBytes(serverStorage.limit_bytes),
                    }),
                overCap ? t("native.downloadsOverview.storageCapExceeded") : null,
              ]
                .filter(Boolean)
                .join("\n")}
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
