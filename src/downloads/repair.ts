/**
 * Repair and retry (FR-89). Runs on boot-while-online and on every NetInfo
 * reconnect: first `retryFailures()` (songs with an errored kind), then
 * `verifyAndRepair()` (walk dl_songs, re-enqueue whatever is missing).
 *
 * Both passes are just `downloadSong()` calls: the manager's enqueue dedup
 * (no-op when the (song, kind) row is done or already scheduled) is what makes
 * repair idempotent, and it is also what heals, in ONE pass:
 *  - transfers lost to process death (rows left queued/downloading),
 *  - libraries downloaded before stems existed (stems-gained re-enqueue),
 *  - files deleted underneath us (verifySongFiles drops the row first),
 *  - lyrics that were never fetched ('unfetched' tri-state, FR-81).
 *
 * A WiFi refusal (FR-88) aborts the pass instead of hammering the gate once
 * per song: the next reconnect on WiFi runs it again.
 */
import {
  downloadSong,
  isStarted,
  isWifiRefusedError,
  listErroredSongKeys,
  listStoredSongs,
  probeWifiGate,
  verifySongFiles,
} from "./manager";
import { getDownloadSettings } from "./settings";

let running = false;

/** ONE gate probe per pass (freeze report 2026-08-14): the per-song
 *  NetInfo round-trip made a full-library walk hundreds of native calls. */
const gateClosed = async (): Promise<boolean> => {
  try {
    await probeWifiGate();
    return false;
  } catch (error) {
    return isWifiRefusedError(error);
  }
};

/** Re-issues the bundle for every song with at least one errored file. */
export const retryFailures = async (): Promise<void> => {
  if (!isStarted()) return;
  const failed = new Set(listErroredSongKeys());
  if (failed.size === 0) return;
  if (await gateClosed()) return; // The next reconnect on WiFi retries.
  for (const stored of listStoredSongs()) {
    if (!failed.has(stored.songKey)) continue;
    try {
      await downloadSong(stored.song, { skipWifiGate: true });
    } catch {
      // Transient; the next reconnect retries.
    }
  }
};

/**
 * Walks every stored song and re-enqueues the missing pieces. Files that
 * vanished from disk are dropped from the index first so the dedup check
 * cannot mistake them for `done`.
 */
export const verifyAndRepair = async (): Promise<void> => {
  if (!isStarted()) return;
  const includeStems = getDownloadSettings().includeStems;
  if (await gateClosed()) return;
  for (const stored of listStoredSongs()) {
    verifySongFiles(stored.songKey);
    try {
      await downloadSong(stored.song, { includeStems, skipWifiGate: true });
    } catch {
      // Transient failure: the row stays as it is for the next pass.
    }
  }
};

/**
 * The single self-healing entry point (boot-while-online + reconnect).
 * Serialized: a reconnect burst never starts two overlapping walks.
 */
export const runRepairPass = async (): Promise<void> => {
  if (running || !isStarted()) return;
  running = true;
  try {
    await retryFailures();
    await verifyAndRepair();
  } finally {
    running = false;
  }
};

export const isRepairRunning = (): boolean => running;
