/**
 * Downloads subsystem wiring, imported by boot/wireup.ts (WP12). It installs
 * every seam this package owns and runs the lifecycle that has to work with
 * or without a mounted screen:
 *
 *  1. LocalFileIndex (contracts/localSource) -> the player's offline ladder
 *     and ui/ArtworkImage's local artwork, both per song and by bare fs node
 *     id for the surfaces that carry no song (FR-90, FR-91).
 *  2. The download status reader (ui/downloadStatus) -> row badges (FR-82/86).
 *  3. Offline library resolvers + the isOfflineNow flag (FR-91, FR-81 read).
 *  4. The DownloadStatusProvider shell provider (WP2's slot registry).
 *  5. The "download" song-menu slot (FR-74 / FR-86).
 *  6. The offline-collections API the collection screens consume (FR-87/93).
 *  7. Session lifecycle: per-user manager start/stop (per-user db + per-user
 *     directory), the last-user memo so an OFFLINE boot still opens the right
 *     library, NetInfo online tracking, and the repair pass on
 *     boot-while-online and on every reconnect (FR-89).
 */
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Paths } from "expo-file-system";
import { setLocalFileIndex } from "@/contracts/localSource";
import {
  registerSongMenuSlot,
  type SongMenuItem,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { resolveUserId } from "@/auth/lastUser";
import { toSongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { registerOfflineCollections } from "@/features/playlist/offlineCollections";
import { registerShellProvider } from "@/features/shell/slots";
import { setDownloadStatusReader } from "@/ui/downloadStatus";
import { startCollectionAutoSync } from "./autoSync";
import { evictableBudgetFor } from "./evict";
import {
  isOfflineCollection,
  subscribeCollections,
  toggleOfflineCollection,
} from "./collections";
import { DownloadStatusProvider, downloadsApi } from "./context";
import { registerDesktopDownloads } from "./desktop";
import { getPlayerEngine } from "@/player/register";
import {
  cachePlayback,
  currentUserId,
  downloadSong,
  downloadedPlaylists,
  evictableUsage,
  getProgressFor,
  getStatusFor,
  isStarted,
  isWifiRefusedError,
  listDownloadedSongs,
  listInFlight,
  localArtworkUriForNode,
  localUriFor,
  predictiveWaste,
  removeDownload,
  startManager,
  stopManager,
  storageUsage,
  storageUsageFast,
} from "./manager";
import { NOTICE_KEYS, notifyDownloadNotice } from "./notices";
import {
  hydrateManualOffline,
  isManualOffline,
  registerOfflineLibrary,
  setOnlineState,
  subscribeManualOffline,
} from "./offlineLibrary";
import { runRepairPass } from "./repair";
import { getDownloadSettings, subscribeDownloadSettings } from "./settings";
import {
  getProgressVersion,
  getStatusVersion,
  subscribeDownloadProgress,
  subscribeDownloadStatus,
} from "./status";
import { registerStemFileProvider } from "./stemProvision";
import { setDownloadsSurface, type DownloadsSurface } from "./surface";

// ---------------------------------------------------------------------------
// Song menu slot (FR-74 order position "download", FR-86 labels)
// ---------------------------------------------------------------------------

const useDownloadStatusTick = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

/** The open menu shows a live percent: it alone rides the progress channel. */
const useDownloadProgressTick = (): number =>
  useSyncExternalStore(subscribeDownloadProgress, getProgressVersion, getProgressVersion);

const useDownloadSlot: SongMenuSlotHook = (ctx) => {
  useDownloadStatusTick(); // Status transitions while a transfer runs.
  useDownloadProgressTick(); // ~1 Hz percent while the menu is open.
  const song = ctx.song;
  // Jam proposals carry ephemeral presigned URLs, never fs nodes: they are
  // not downloadable (one of the three independent jam guards).
  if (song.jam_song) return [];

  const status = getStatusFor(song.id);

  if (status === "done") {
    const item: SongMenuItem = {
      id: "download-remove",
      labelKey: "native.downloads.menuRemove",
      icon: "trash",
      destructive: true,
      onPress: () => {
        void removeDownload(song.id);
      },
    };
    return [item];
  }

  if (status === "downloading" || status === "queued") {
    const item: SongMenuItem = {
      id: "download-progress",
      labelKey: "native.downloads.menuDownloading",
      labelParams: { percent: Math.round(getProgressFor(song.id) * 100) },
      icon: "download",
      disabled: true,
      onPress: () => {},
    };
    return [item];
  }

  const item: SongMenuItem = {
    id: "download",
    labelKey: "native.downloads.menuDownload",
    icon: "download",
    onPress: () => {
      void downloadsApi.download(song);
    },
  };
  return [item];
};

// ---------------------------------------------------------------------------
// The platform-neutral surface (downloads/surface.ts)
// ---------------------------------------------------------------------------

/**
 * Native's face of the settings screens' reads. Everything here already
 * existed; the indirection is what lets the same screens render on the Tauri
 * shell (Rust-backed) and in a plain tab (inert zeros) with no platform
 * branch of their own.
 *
 * `pinnedUsage` is the subtraction the overview used to do inline: total done
 * bytes minus the evictable tier leaves exactly what the user asked for.
 */
const nativeDownloadsSurface: DownloadsSurface = {
  available: isStarted,
  listDownloadedSongs,
  downloadedPlaylists: () =>
    downloadedPlaylists().map((row) => ({
      id: row.id,
      name: row.name,
      // The SQLite column keeps its fs_nodes-era name; the value is a media id.
      artworkMediaId: row.artwork_fs_node_id,
      songCount: row.song_count,
      sourceExternalId: row.source_external_id,
    })),
  listInFlight,
  pinnedUsage: () => {
    const total = storageUsageFast();
    const evictable = evictableUsage();
    return {
      bytes: Math.max(0, total.bytes - evictable.bytes),
      files: Math.max(0, total.files - evictable.files),
    };
  },
  evictableUsage,
  storageUsageSlow: storageUsage,
  // The ceiling the sweep drives the evictable tier down to. `Paths` is a
  // native PROPERTY read, not a directory walk, so this stays render-safe
  // (invariant I2) and the settings screen can draw the headroom bar.
  evictableBudget: () => {
    const override = getDownloadSettings().evictableBudgetBytes;
    if (override != null && Number.isFinite(override) && override >= 0) return override;
    try {
      return evictableBudgetFor(Paths.availableDiskSpace);
    } catch {
      return null;
    }
  },
  predictiveWaste,
  // Never rejects: a WiFi refusal (FR-88) or a failed enqueue reports through
  // the notice channel, so `void surface.download(song)` call sites cannot
  // produce unhandled rejections.
  download: async (song, opts) => {
    try {
      await downloadSong(song, opts);
    } catch (error) {
      notifyDownloadNotice(
        isWifiRefusedError(error) ? NOTICE_KEYS.wifiRefused : NOTICE_KEYS.enqueueFailed,
      );
    }
  },
  remove: removeDownload,
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * The signed-in user id, with the offline-boot fallback: a launch in airplane
 * mode keeps the token but resolves no account payload, so the remembered id
 * is what lets the downloaded library open at all (FR-91 AC).
 *
 * The memo itself moved to auth/lastUser.ts, which subscribes on EVERY
 * platform. It used to be written here, below the web early-return, and that
 * placement silently killed the persisted query cache on web and on desktop -
 * api/persistCache.ts keys its snapshot on the same kv entry.
 */
const syncManagerToSession = (): void => {
  // Only ever wired up on native: registerDownloads returns before any
  // subscription on web, where the expo-sqlite + expo-file-system stack
  // underneath the manager has no browser build.
  const userId = resolveUserId();
  if (!userId) {
    if (currentUserId()) stopManager();
    return;
  }
  if (currentUserId() === userId) return;
  startManager(userId);
  // Boot (or account switch) while online: heal whatever the last run left
  // behind - process-death losses, missing stems, unfetched lyrics. The GO
  // OFFLINE override means "touch nothing", repair included.
  void NetInfo.fetch()
    .then((state) => {
      if (state.isConnected && !isManualOffline()) void runRepairPass();
    })
    .catch(() => undefined);
};

let wasConnected = true;

const handleNetworkState = (connected: boolean): void => {
  setOnlineState(connected);
  if (connected && !wasConnected && !isManualOffline()) {
    void runRepairPass();
  }
  wasConnected = connected;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

/** Idempotent; wireup calls it once at boot. */
export const registerDownloads = (): void => {
  if (registered) return;
  registered = true;

  // Web build: THIS module's stack does not exist (plano "uma so app", F1).
  // Underneath it are expo-sqlite and expo-file-system, neither of which has
  // a browser build here, so every registration below would be either inert
  // or actively harmful on web: the "Transferir" song-menu slot would render
  // a button whose only possible outcome is an error, and the offline
  // resolvers would let a persisted GO OFFLINE flag (kv survives reloads)
  // empty the whole library with nothing on screen explaining why.
  //
  // "Web" is now TWO platforms, though, and they want opposite things:
  //
  //  - a plain browser tab (music.omelhorsite.pt) streams. Every seam keeps
  //    its inert default - no row badges, no keep-synced toggle, no offline
  //    ladder, no repair pass - and the GO OFFLINE switch never surfaces
  //    (features/downloads/overview hides it on web for the same reason);
  //
  //  - the Tauri shell has a real local media store, written in Rust. The
  //    desktop fork installs the SAME seams over it, so the player ladder,
  //    the badges and the offline resolvers work there without this module
  //    (or the player, or any screen) learning which platform it is on.
  //
  // The fork decides for itself: it returns immediately unless the shell
  // injected `window.__OMS_DESKTOP__.cacheAvailable === true`. On Linux that
  // flag is false (WebKitGTK cannot play media from a custom URI scheme,
  // WebKit bug 146351) and the shell therefore behaves as a plain tab.
  if (Platform.OS === "web") {
    registerDesktopDownloads();
    return;
  }

  setLocalFileIndex({ get: localUriFor, getArtworkByNodeId: localArtworkUriForNode });

  // Native installs the manager-backed face of the same surface the settings
  // screens read; the desktop fork installs the Rust-backed one, and a plain
  // tab keeps the inert default.
  setDownloadsSurface(nativeDownloadsSurface);

  // Custom blend: the mixer plays local files only, so the player asks this
  // package to bring both stems onto disk first (DESIGN 16.1 amendment).
  registerStemFileProvider();

  setDownloadStatusReader({
    getStatus: getStatusFor,
    getProgress: getProgressFor,
    subscribe: subscribeDownloadStatus,
    subscribeProgress: subscribeDownloadProgress,
  });

  registerOfflineLibrary();

  registerShellProvider(DownloadStatusProvider);
  registerSongMenuSlot("download", useDownloadSlot);

  registerOfflineCollections({
    isOfflineCollection,
    toggleOfflineCollection,
    getShowOnlyDownloaded: () => getDownloadSettings().showOnlyDownloaded,
    // NO status subscription here (freeze report 2026-08-14): the ActionBar
    // toggle and the show-only-downloaded filter change on collection and
    // settings events; wiring download-status bumps through this bundle
    // re-rendered every collection screen during every transfer. Screens
    // that filter by status subscribe to useDownloadStatusVersion directly
    // (transition-only since the same report).
    subscribe: (cb) => {
      const unsubscribeCollections = subscribeCollections(cb);
      const unsubscribeSettings = subscribeDownloadSettings(cb);
      return () => {
        unsubscribeCollections();
        unsubscribeSettings();
      };
    },
  });

  // Logout wipes the scheduler and closes the per-user database; the files
  // and the db stay on disk, namespaced per user (DESIGN 6).
  registerLogoutTask(() => {
    stopManager();
  });

  // Collections keep themselves synced off collection query successes.
  startCollectionAutoSync();

  useSessionStore.subscribe(syncManagerToSession);
  // BEFORE the first NetInfo event: a persisted GO OFFLINE must never let
  // the boot flash online (and kick repairs) first.
  hydrateManualOffline();
  syncManagerToSession();

  void NetInfo.fetch()
    .then((state) => {
      wasConnected = !!state.isConnected;
      setOnlineState(!!state.isConnected);
    })
    .catch(() => undefined);
  NetInfo.addEventListener((state) => handleNetworkState(!!state.isConnected));

  // Mirror of the reconnect path: flipping GO OFFLINE back off while the
  // network is up owes the library the repair pass the flag suppressed.
  subscribeManualOffline(() => {
    if (!isManualOffline() && wasConnected) void runRepairPass();
  });

  // Play cache (owner request 2026-08-08): every song that KEEPS playing
  // caches its mixed file (manager.cachePlayback - orphan tier, silent, 7 day
  // TTL). The download starts 8s in, NOT at once: on a slow connection an
  // immediate download competes with the live stream for the same bytes
  // (owner report 2026-08-10, "pára do nada"), and skipped songs never get
  // cached at all. The residency watcher below then pokes the engine ONCE
  // when the current song's audio becomes local, so the EQ passthrough can
  // engage mid play without waiting for a track change.
  const CACHE_DELAY_MS = 8_000;
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let mainWasResident = false;
  const currentMainResident = (): boolean => {
    const song = getPlayerEngine().getCurrentSong();
    if (!song) return false;
    const key = toSongKey(song.id);
    return !!(localUriFor(key, "mixed") ?? localUriFor(key, "mixed_original"));
  };
  getPlayerEngine().on("songChanged", (payload) => {
    const song = (payload as { song: Song | null } | undefined)?.song ?? null;
    mainWasResident = currentMainResident();
    if (cacheTimer) {
      clearTimeout(cacheTimer);
      cacheTimer = null;
    }
    if (!song) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      // Checked at FIRE time, not arm time: a controller stint (the engine
      // holds no source; this device is not the one playing) and the GO
      // OFFLINE override both cancel the cache, not just delay it.
      if (isManualOffline()) return;
      if (!getPlayerEngine().hasLoadedSource()) return;
      void cachePlayback(song).catch(() => undefined);
    }, CACHE_DELAY_MS);
  });
  subscribeDownloadStatus(() => {
    const resident = currentMainResident();
    // hasLoadedSource: a silent controller must never prepare a mixer graph.
    if (resident && !mainWasResident && getPlayerEngine().hasLoadedSource()) {
      getPlayerEngine().retryStemBlend();
    }
    mainWasResident = resident;
  });
};

// Importing the module registers (wireup imports every register.ts).
registerDownloads();
