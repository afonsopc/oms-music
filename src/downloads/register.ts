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
import { setLocalFileIndex } from "@/contracts/localSource";
import {
  registerSongMenuSlot,
  type SongMenuItem,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { kvGet, kvSet } from "@/db/kv";
import { toSongKey, type UserId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { registerOfflineCollections } from "@/features/playlist/offlineCollections";
import { registerShellProvider } from "@/features/shell/slots";
import { setDownloadStatusReader } from "@/ui/downloadStatus";
import { startCollectionAutoSync } from "./autoSync";
import {
  isOfflineCollection,
  subscribeCollections,
  toggleOfflineCollection,
} from "./collections";
import { DownloadStatusProvider, downloadsApi } from "./context";
import { getPlayerEngine } from "@/player/register";
import {
  cachePlayback,
  currentUserId,
  getProgressFor,
  getStatusFor,
  localArtworkUriForNode,
  localUriFor,
  removeDownload,
  startManager,
  stopManager,
} from "./manager";
import { registerOfflineLibrary, setOnlineState } from "./offlineLibrary";
import { runRepairPass } from "./repair";
import { getDownloadSettings, subscribeDownloadSettings } from "./settings";
import { getStatusVersion, subscribeDownloadStatus } from "./status";
import { registerStemFileProvider } from "./stemProvision";

const LAST_USER_KV_KEY = "oms-music.downloads.last-user-id";

// ---------------------------------------------------------------------------
// Song menu slot (FR-74 order position "download", FR-86 labels)
// ---------------------------------------------------------------------------

const useDownloadStatusTick = (): number =>
  useSyncExternalStore(subscribeDownloadStatus, getStatusVersion, getStatusVersion);

const useDownloadSlot: SongMenuSlotHook = (ctx) => {
  useDownloadStatusTick(); // Coarse refresh while a transfer runs.
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
// Session lifecycle
// ---------------------------------------------------------------------------

const rememberUser = (userId: UserId): void => {
  if (kvGet(LAST_USER_KV_KEY) === userId) return;
  kvSet(LAST_USER_KV_KEY, userId);
};

/**
 * The signed-in user id. An offline boot keeps the token but resolves no
 * account payload (auth/session), so the last known id is what lets the
 * downloaded library open in airplane mode (FR-91 AC).
 */
const resolveUserId = (): UserId | null => {
  const state = useSessionStore.getState();
  if (state.status !== "authed") return null;
  const known = state.user?.id ?? state.session?.user_id ?? null;
  if (known) {
    rememberUser(known);
    return known;
  }
  const remembered = kvGet(LAST_USER_KV_KEY);
  return remembered ? (remembered as UserId) : null;
};

const syncManagerToSession = (): void => {
  // The downloads stack is expo-sqlite + expo-file-system, neither of which
  // has a browser build here: on web the manager simply never starts, every
  // read degrades (empty downloads, inert LocalFileIndex) and playback
  // streams - which is what a browser tab should do anyway.
  if (Platform.OS === "web") return;
  const userId = resolveUserId();
  if (!userId) {
    if (currentUserId()) stopManager();
    return;
  }
  if (currentUserId() === userId) return;
  startManager(userId);
  // Boot (or account switch) while online: heal whatever the last run left
  // behind - process-death losses, missing stems, unfetched lyrics.
  void NetInfo.fetch()
    .then((state) => {
      if (state.isConnected) void runRepairPass();
    })
    .catch(() => undefined);
};

let wasConnected = true;

const handleNetworkState = (connected: boolean): void => {
  setOnlineState(connected);
  if (connected && !wasConnected) {
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

  setLocalFileIndex({ get: localUriFor, getArtworkByNodeId: localArtworkUriForNode });

  // Custom blend: the mixer plays local files only, so the player asks this
  // package to bring both stems onto disk first (DESIGN 16.1 amendment).
  registerStemFileProvider();

  setDownloadStatusReader({
    getStatus: getStatusFor,
    getProgress: getProgressFor,
    subscribe: subscribeDownloadStatus,
  });

  registerOfflineLibrary();

  registerShellProvider(DownloadStatusProvider);
  registerSongMenuSlot("download", useDownloadSlot);

  registerOfflineCollections({
    isOfflineCollection,
    toggleOfflineCollection,
    getShowOnlyDownloaded: () => getDownloadSettings().showOnlyDownloaded,
    subscribe: (cb) => {
      const unsubscribeCollections = subscribeCollections(cb);
      const unsubscribeSettings = subscribeDownloadSettings(cb);
      const unsubscribeStatus = subscribeDownloadStatus(cb);
      return () => {
        unsubscribeCollections();
        unsubscribeSettings();
        unsubscribeStatus();
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
  syncManagerToSession();

  void NetInfo.fetch()
    .then((state) => {
      wasConnected = !!state.isConnected;
      setOnlineState(!!state.isConnected);
    })
    .catch(() => undefined);
  NetInfo.addEventListener((state) => handleNetworkState(!!state.isConnected));

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
      void cachePlayback(song).catch(() => undefined);
    }, CACHE_DELAY_MS);
  });
  subscribeDownloadStatus(() => {
    const resident = currentMainResident();
    if (resident && !mainWasResident) getPlayerEngine().retryStemBlend();
    mainWasResident = resident;
  });
};

// Importing the module registers (wireup imports every register.ts).
registerDownloads();
