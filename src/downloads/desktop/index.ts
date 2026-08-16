/**
 * The desktop downloads fork.
 *
 * There is NO `.tauri.ts` extension anywhere in this design, and that is
 * deliberate: one web bundle serves both `music.omelhorsite.pt` and the Tauri
 * shell, so every fork has to be a RUNTIME branch. The branch is
 * `window.__OMS_DESKTOP__`, injected by the shell before the bundle is parsed
 * (lib.rs `initialization_script`), because `downloads/register.ts` runs at
 * import time and cannot await an `invoke`.
 *
 * Registration order matters and is split in two on purpose:
 *
 *  1. SYNCHRONOUS, right now, before `cache_open` has even been called: the
 *     shell provider, the song-menu slot, the seams. Provider order decides
 *     nesting order, and a provider registered a few hundred milliseconds
 *     later would remount the whole tree under a user who is already looking
 *     at it. This is safe precisely because every seam installed here is
 *     inert until the session opens: the menu item goes through
 *     `DownloadsSurface` (which answers `available() === false` until then)
 *     and the badge reads "none".
 *
 *  2. ASYNCHRONOUS, once a user is signed in: open the per-user cache,
 *     subscribe to the ONE event channel, hydrate the collections.
 *
 * On Linux `cacheAvailable` is false (WebKitGTK cannot play media from a
 * custom URI scheme - WebKit bug 146351, open since 2015), so none of this
 * installs and the app behaves exactly like a browser tab. That is a designed
 * outcome, not a runtime surprise.
 */
import { API_BASE_URL } from "@/api/client";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { resolveUserId } from "@/auth/lastUser";
import { getToken } from "@/auth/token";
import { setLocalFileIndex } from "@/contracts/localSource";
import {
  registerSongMenuSlot,
  type SongMenuItem,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { desktopCapabilities } from "@/desktop/tauri";
import { toSongKey, type UserId } from "@/domain/ids";
import { registerOfflineCollections } from "@/features/playlist/offlineCollections";
import { registerShellProvider } from "@/features/shell/slots";
import { playerStore, type PlayerStoreState } from "@/player/store";
import { setPrefetchHost, stopPrefetch } from "@/prefetch/driver";
import { setDownloadStatusReader, useDownloadBadgeVersion } from "@/ui/downloadStatus";
import { DownloadStatusProvider } from "../context";
import { getDownloadSettings, subscribeDownloadSettings } from "../settings";
import { subscribeDownloadProgress, subscribeDownloadStatus } from "../status";
import { getDownloadsSurface, setDownloadsSurface } from "../surface";
import { cacheSubscribe } from "./bridge";
import {
  desktopDownloadedCollections,
  hydrateDesktopCollections,
  isOfflineCollection,
  startDesktopCollectionAutoSync,
  stopDesktopCollections,
  subscribeDesktopCollections,
  toggleOfflineCollection,
} from "./collections";
import { applyCacheEvent, setCacheEventObserver } from "./events";
import { desktopLocalFileIndex } from "./localIndex";
import { registerDesktopOfflineLibrary } from "./library";
import {
  closeDesktopCache,
  desktopDownloadsSurface,
  desktopPrefetchHost,
  getProgressFor,
  getStatusFor,
  noteCacheEvent,
  openDesktopCache,
  promotePlayback,
  updateDesktopCacheAuth,
} from "./manager";
import { registerDesktopOnlineState } from "./offline";

// ---------------------------------------------------------------------------
// Song menu slot
// ---------------------------------------------------------------------------

/**
 * Same three states and the same labels as the native slot. It subscribes to
 * BOTH channels because an open menu is one of the very few surfaces that
 * renders a live percent; a row badge subscribes to the coarse one only.
 */
const useDesktopDownloadSlot: SongMenuSlotHook = (ctx) => {
  useDownloadBadgeVersion();
  const song = ctx.song;
  // Jam proposals carry ephemeral presigned URLs and no media ids: not
  // downloadable, on any platform.
  if (song.jam_song) return [];

  const status = getStatusFor(song.id);

  if (status === "done") {
    const item: SongMenuItem = {
      id: "download-remove",
      labelKey: "native.downloads.menuRemove",
      icon: "trash",
      destructive: true,
      onPress: () => {
        void getDownloadsSurface().remove(song.id);
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
      void getDownloadsSurface().download(song);
    },
  };
  return [item];
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

let openUserId: UserId | null = null;
let opening = false;
let lastToken: string | null = null;

const openFor = async (userId: UserId): Promise<void> => {
  if (opening) return;
  opening = true;
  try {
    lastToken = getToken();
    const ok = await openDesktopCache(userId, API_BASE_URL, lastToken);
    if (!ok) {
      // Rust declined (no media server on this platform). Leave every seam
      // installed but inert: the surface answers `available() === false` and
      // the app streams.
      openUserId = null;
      return;
    }
    openUserId = userId;
    // ONE long-lived channel for every status and progress event. A shell too
    // old to expose core.Channel simply gets no live updates; the debounced
    // re-read in the manager still keeps the local index honest.
    await cacheSubscribe(applyCacheEvent);
    await hydrateDesktopCollections();
    startDesktopCollectionAutoSync();
  } catch {
    openUserId = null;
  } finally {
    opening = false;
  }
};

const syncCacheToSession = (): void => {
  // Same lifecycle rule as the native manager: exactly one open cache per
  // signed-in user, and none at all when nobody is signed in. `resolveUserId`
  // already falls back to the memo, which is what lets an OFFLINE launch (a
  // stored token, no resolved account payload) open the right library.
  const userId = resolveUserId();
  if (!userId) {
    if (openUserId) {
      openUserId = null;
      lastToken = null;
      void closeDesktopCache();
    }
    return;
  }
  if (openUserId === userId) {
    // Same user, possibly a rotated token. Without this every later transfer
    // would 404 against `/media/:id/data?token=` until the next sign-in.
    const token = getToken();
    if (token !== lastToken) {
      lastToken = token;
      updateDesktopCacheAuth(API_BASE_URL, token);
    }
    return;
  }
  void openFor(userId);
};

/**
 * Promotion on playback, the desktop half of `touchAndPromote`. Delayed for
 * the same reason the native play cache is: a song the user skipped after two
 * seconds was not "played", and promoting it would keep a bad guess alive at
 * the expense of a good one. Checked at FIRE time so a track change in the
 * meantime cancels rather than promotes the wrong row.
 */
const PROMOTE_DELAY_MS = 8_000;

const watchPlaybackForPromotion = (): void => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSongId: number | string | null = null;
  const react = (state: PlayerStoreState): void => {
    const songId = state.currentSong?.id ?? null;
    if (songId === lastSongId) return;
    lastSongId = songId;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (songId == null) return;
    timer = setTimeout(() => {
      timer = null;
      if (playerStore.getState().currentSong?.id !== songId) return;
      promotePlayback(toSongKey(Number(songId)));
    }, PROMOTE_DELAY_MS);
  };
  playerStore.subscribe(react);
  react(playerStore.getState());
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

/**
 * Idempotent. Returns immediately - installing nothing at all - unless this
 * really is the desktop shell AND its media protocol works.
 */
export const registerDesktopDownloads = (): void => {
  if (registered) return;
  if (desktopCapabilities()?.cacheAvailable !== true) return;
  registered = true;

  // --- 1. Synchronous seams -------------------------------------------------

  setLocalFileIndex(desktopLocalFileIndex);

  // BOTH channels, and they are the SAME module native uses (invariant I1):
  // coarse on transitions, ~1 Hz for percent. Rust applied the identical split
  // before the events crossed IPC, so the discipline is enforced twice and
  // neither layer trusts the other.
  setDownloadStatusReader({
    getStatus: getStatusFor,
    getProgress: getProgressFor,
    subscribe: subscribeDownloadStatus,
    subscribeProgress: subscribeDownloadProgress,
  });

  // A leitura das colecções vive em collections.ts (que já importa o manager,
  // dono da surface) - compor aqui é o que evita um ciclo manager<->collections.
  setDownloadsSurface({
    ...desktopDownloadsSurface,
    downloadedCollections: desktopDownloadedCollections,
  });

  // DownloadStatusProvider is registered for provider-order parity with
  // native (it is the outermost shell provider, DESIGN 2) and so the dev seam
  // report reads the same on both. Note that the CONTEXT value it publishes is
  // still the native-bound one from downloads/context.tsx; nothing on desktop
  // consumes it, and everything that could - the menu slot below, the screens -
  // goes through DownloadsSurface instead.
  registerShellProvider(DownloadStatusProvider);
  registerSongMenuSlot("download", useDesktopDownloadSlot);

  registerOfflineCollections({
    isOfflineCollection,
    toggleOfflineCollection: (key, songs) => toggleOfflineCollection(key, songs),
    getShowOnlyDownloaded: () => getDownloadSettings().showOnlyDownloaded,
    // NO download-status subscription here, exactly as on native (freeze
    // report 2026-08-14): wiring status bumps through this bundle re-rendered
    // every collection screen for the duration of every transfer.
    subscribe: (cb) => {
      const offCollections = subscribeDesktopCollections(cb);
      const offSettings = subscribeDownloadSettings(cb);
      return () => {
        offCollections();
        offSettings();
      };
    },
  });

  registerDesktopOnlineState();
  registerDesktopOfflineLibrary();

  // The predictive driver from owner A, unchanged, over the Rust cache. Rust
  // enforces the single-slot and suspension rules itself, so a refusal here is
  // a boolean the driver heals from on its next fire.
  setPrefetchHost(desktopPrefetchHost);

  setCacheEventObserver(noteCacheEvent);

  registerLogoutTask(() => {
    stopPrefetch();
    stopDesktopCollections();
    openUserId = null;
    lastToken = null;
    void closeDesktopCache();
  });

  // --- 2. Asynchronous session ---------------------------------------------

  useSessionStore.subscribe(syncCacheToSession);
  syncCacheToSession();
  watchPlaybackForPromotion();
};
