/**
 * Native binding for the predictive prefetch driver. Self-registering on
 * import, exactly like downloads/register.ts, and a no-op on any platform
 * that is not native: the desktop shell installs its own host over the Rust
 * cache (downloads/desktop/manager.ts), and a plain browser tab streams.
 *
 * Everything here is a THIN adapter. The arbitration lives in policy.ts, the
 * timing in driver.ts, the bytes in downloads/manager.ts; this file only
 * decides which of those functions answers which question, and holds the two
 * pieces of state neither of them can own: the network snapshot and the
 * per-session predictive byte budget.
 */
import { Platform } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { registerLogoutTask } from "@/auth/session";
import type { MediaId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import {
  cachePredictive,
  cancelPredictive,
  explicitInFlight,
  getProgressFor,
  isResident,
  isTransferring,
  onManagerStarted,
  predictiveSessionBudgetBytes,
  setPredictiveBytesListener,
} from "@/downloads/manager";
import {
  isManualOffline,
  isOnline,
  subscribeManualOffline,
  subscribeOnlineState,
} from "@/downloads/offlineLibrary";
import { getDownloadSettings, subscribeDownloadSettings } from "@/downloads/settings";
import { revokePrefetch, setPrefetchHost, stopPrefetch, type PrefetchHost } from "./driver";
import type { PrefetchGates } from "./gates";

// ---------------------------------------------------------------------------
// Network snapshot
//
// Invariant I3: the driver holds ONE cached snapshot and never probes NetInfo
// per want. downloads/register.ts already owns the process's only
// NetInfo.addEventListener, so the richest path is for that listener to push
// here (setPrefetchNetworkSnapshot) rather than for this module to open a
// second one.
//
// Until that wiring lands, the snapshot is seeded once at boot and refreshed
// at most once every STALE_MS, and a snapshot older than that is treated as
// "not on WiFi" - the conservative direction, because predictiveWifiOnly
// defaults ON and a wrong guess on cellular costs the user money.
// ---------------------------------------------------------------------------

const SNAPSHOT_STALE_MS = 120_000;

interface NetSnapshot {
  onWifi: boolean;
  metered: boolean;
  at: number;
}

let snapshot: NetSnapshot = { onWifi: false, metered: false, at: 0 };
let refreshing = false;

/** Push point for the EXISTING NetInfo listener. Idempotent, allocation-free. */
export const setPrefetchNetworkSnapshot = (state: NetInfoState): void => {
  const details = state.details as { isConnectionExpensive?: boolean | null } | null;
  snapshot = {
    onWifi: state.type === "wifi",
    metered: details?.isConnectionExpensive === true,
    at: Date.now(),
  };
  // Losing WiFi (or landing on a metered link) has to reach the transfer that
  // is ALREADY running, not just the next one the driver would arm.
  revokePrefetch();
};

const refreshSnapshotSoon = (): void => {
  if (refreshing) return;
  refreshing = true;
  // At most ONE probe per SNAPSHOT_STALE_MS, and never inside a want loop.
  // This is the fallback path; once the existing listener pushes here it
  // never runs at all.
  void NetInfo.fetch()
    .then(setPrefetchNetworkSnapshot)
    .catch(() => undefined)
    .finally(() => {
      refreshing = false;
    });
};

const freshSnapshot = (): NetSnapshot => {
  if (Date.now() - snapshot.at <= SNAPSHOT_STALE_MS) return snapshot;
  refreshSnapshotSoon();
  return { onWifi: false, metered: snapshot.metered, at: snapshot.at };
};

// ---------------------------------------------------------------------------
// Per-session predictive byte budget
//
// A waste ceiling, not a cache size: it caps how much this SESSION is allowed
// to spend on guesses. Deliberately not persisted - it resets on a cold
// foreground and on sign-in, which is exactly when the user's context (and
// therefore the value of our guesses) changed.
// ---------------------------------------------------------------------------

let sessionBytesSpent = 0;

const resetSessionBudget = (): void => {
  sessionBytesSpent = 0;
};

// ---------------------------------------------------------------------------
// Artwork
//
// Owner D's api/artworkPrefetch installs the real implementation: on native a
// bare `Image.prefetch(url)` is provably useless, because expo-image stores
// the bytes under the URL key while ArtworkImage looks them up under the
// media id (design 7.1). Rather than burn the user's data on a cache nobody
// reads, the default here does NOTHING and says so.
// ---------------------------------------------------------------------------

let artworkPrefetcher: ((ids: MediaId[]) => void) | null = null;

export const setArtworkPrefetcher = (fn: ((ids: MediaId[]) => void) | null): void => {
  artworkPrefetcher = fn;
};

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

const gates = (): PrefetchGates => {
  const settings = getDownloadSettings();
  const net = freshSnapshot();
  return {
    manualOffline: isManualOffline(),
    online: isOnline(),
    // Either switch is enough: the predictive one is stricter by default.
    wifiOnly: settings.wifiOnly || settings.predictiveWifiOnly,
    onWifi: net.onWifi,
    metered: net.metered,
    sessionBudgetExhausted: sessionBytesSpent >= predictiveSessionBudgetBytes(),
    explicitInFlight: explicitInFlight(),
    predictiveEnabled: settings.predictiveEnabled,
  };
};

const nativeHost: PrefetchHost = {
  // mixed_original counts as resident: the player's ladder serves it happily
  // and re-fetching the compressed mix on top of a master already on disk
  // would be pure waste.
  resident: (songKey: SongKey) =>
    isResident(songKey, "mixed") || isResident(songKey, "mixed_original"),
  inFlight: (songKey: SongKey) => isTransferring(songKey, "mixed"),
  explicitInFlight,
  startAudio: (_songKey: SongKey, _mediaId: MediaId, song: Song) => {
    cachePredictive(song);
  },
  cancelAudio: cancelPredictive,
  progressOf: (songKey: SongKey) => getProgressFor(songKey),
  prefetchArtwork: (mediaIds: MediaId[]) => {
    artworkPrefetcher?.(mediaIds);
  },
  gates,
  noteBytes: (n: number) => {
    if (n > 0) sessionBytesSpent += n;
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

/** Idempotent; wireup imports this module for its side effect. */
export const registerPrefetch = (): void => {
  if (registered) return;
  registered = true;

  // Web (plain browser AND the Tauri shell): nothing here. The desktop fork
  // installs its own host over the Rust cache; a browser tab has no local
  // store to prefetch INTO, so a predictive tier would be pure waste.
  if (Platform.OS === "web") return;

  setPrefetchHost(nativeHost);
  // Every gate SOURCE, wired to an immediate re-evaluation. Reading the gates
  // at fire time only covers arm -> fire; a user who flips GO OFFLINE (or turns
  // the predictive tier off) while a guess is streaming has to see it stop
  // NOW, not when the current transfer happens to end. These are plain
  // subscriptions on stores that already exist - no new listener, no polling,
  // and nothing here renders.
  subscribeManualOffline(revokePrefetch);
  subscribeOnlineState(revokePrefetch);
  subscribeDownloadSettings(revokePrefetch);
  // Real completed bytes, measured by the manager. The driver never guesses
  // a size, so this is the only thing that can move the session budget.
  setPredictiveBytesListener((bytes) => nativeHost.noteBytes(bytes));
  onManagerStarted(resetSessionBudget);
  registerLogoutTask(() => {
    stopPrefetch();
    resetSessionBudget();
  });
  refreshSnapshotSoon();
};

registerPrefetch();
