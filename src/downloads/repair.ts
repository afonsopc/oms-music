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
 *
 * Since 2026-08-14 the walk also RECONCILES media ids. It used to re-issue the
 * STORED payload, which meant `enqueueKind` compared the stored ids against
 * themselves and always matched - a re-transcoded song would have played its
 * old bytes forever. The walk now prefers a fresher payload out of the
 * react-query cache (see `freshSongIndex`), so the id comparison has something
 * to compare against and the wrong bytes get dropped and refetched.
 */
import type { Query } from "@tanstack/react-query";
import { queryClient } from "@/api/queryClient";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { extractSongs } from "./autoSync";
import {
  downloadSong,
  isStarted,
  isWifiRefusedError,
  listErroredSongKeys,
  listStoredSongs,
  probeWifiGate,
  verifySongFiles,
} from "./manager";
import { hasMediaIdFields, planReconciliation } from "./reconcile";
import { getDownloadSettings } from "./settings";

let running = false;

/**
 * Query keys whose data is a list of Songs (or of rows wrapping one). Reading
 * the whole cache would also walk search results, jam proposals and radio
 * seeds; these three shapes are the ones that carry the CANONICAL server
 * payload for a song in the user's own library.
 */
const isSongBearingKey = (key: readonly unknown[]): boolean =>
  key[0] === "playlistSongs" ||
  (key[0] === "songs" && (key[1] === "byAlbum" || key[1] === "list" || key[1] === "infinite")) ||
  key[0] === "liked";

/**
 * The freshest Song payload we already have for each song id, harvested from
 * the react-query cache. Zero requests: the warm-up sweep (api/warmup) and
 * every screen the user opened have already filled this in, and the whole
 * point of the local-first design is to reuse what is in memory rather than
 * re-ask the server 500 times during a repair walk.
 *
 * Built ONCE per pass, off any render path (repair runs on boot-while-online
 * and on reconnect), and last-writer-wins: a song that appears in several
 * lists resolves to whichever copy react-query stored most recently, and any
 * of them is newer than what dl_songs is holding.
 */
const freshSongIndex = (): Map<SongId, Song> => {
  const index = new Map<SongId, Song>();
  let queries: Query[];
  try {
    queries = queryClient.getQueryCache().getAll();
  } catch {
    return index; // No cache yet: the pass falls back to the stored payloads.
  }
  for (const query of queries) {
    if (query.state.status !== "success") continue;
    if (!isSongBearingKey(query.queryKey as readonly unknown[])) continue;
    for (const song of extractSongs(query.state.data)) {
      // Jam proposals never reach dl_songs and must never be re-issued.
      if (song.jam_song || song.audio_url) continue;
      // A payload that does not CARRY the media-id fields is not evidence that
      // the server dropped the attachments - it is evidence that this endpoint
      // does not serialize them. `extractSongs` casts anything with a numeric
      // `id` to Song, so one trimmed list row would otherwise be read as "the
      // compressed transcode is gone", disagree with the stored node id, and
      // get a perfectly good downloaded file replaced on every repair pass.
      if (!hasMediaIdFields(song)) continue;
      index.set(song.id, song);
    }
  }
  return index;
};

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

/** Songs whose media ids moved under us in the last pass (diagnostics). */
let lastReconciledKeys: string[] = [];

/** What the previous verify pass had to re-fetch because the bytes changed. */
export const lastReconciled = (): readonly string[] => lastReconciledKeys;

/**
 * Walks every stored song and re-enqueues the missing pieces. Files that
 * vanished from disk are dropped from the index first so the dedup check
 * cannot mistake them for `done`.
 *
 * The payload handed to `downloadSong` is the freshest one available (see
 * `freshSongIndex`), never blindly the stored one: that is the whole
 * reconciliation. `enqueueKind` does the actual comparison and drops the
 * wrong bytes, so nothing here needs to know how a file is stored - it only
 * has to stop lying to it about which bytes are wanted.
 */
export const verifyAndRepair = async (): Promise<void> => {
  if (!isStarted()) return;
  const includeStems = getDownloadSettings().includeStems;
  if (await gateClosed()) return;

  const fresh = freshSongIndex();
  const plan = planReconciliation(listStoredSongs(), fresh);
  const reconciled: string[] = [];

  for (const item of plan) {
    verifySongFiles(item.songKey);
    if (item.stale) reconciled.push(item.songKey);
    try {
      await downloadSong(item.song, { includeStems, skipWifiGate: true });
    } catch {
      // Transient failure: the row stays as it is for the next pass.
    }
  }
  lastReconciledKeys = reconciled;
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
