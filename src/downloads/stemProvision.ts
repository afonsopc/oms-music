/**
 * The fetching StemFileProvider (DESIGN 16.1 amendment 2026-08-03).
 *
 * The custom blend needs BOTH stems fully on local disk before it may play,
 * so this provider answers "resident?" from the LocalFileIndex and, when the
 * files are missing, enqueues the two stem transfers through the existing
 * download scheduler and reports combined progress. The plain mix stays
 * audible the whole time; the caller swaps to the blend only once both files
 * land, so a half mix is never audible (web parity: the original keeps
 * playing until both stem buffers have decoded).
 *
 * Fetches are deduped per song, exactly like the web's promise-valued buffer
 * cache: two callers entering custom mode for the same song share one wait.
 *
 * Both device download settings are honoured (FR-93): "Only over WiFi" through
 * the manager's enqueue-time gate, and "Include separated stems" here, before
 * anything is enqueued.
 */
import {
  residentFromLocalIndex,
  setStemFileProvider,
  type StemFileProvider,
  type StemFiles,
} from "@/contracts/stemFiles";
import type { DownloadKind } from "@/domain/downloads";
import type { SongKey } from "@/domain/ids";
import { toSongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { downloadStemsForPlayback } from "./manager";
import { getDownloadSettings } from "./settings";
import { getKindStatus, subscribeDownloadStatus } from "./status";

const STEM_KINDS: readonly DownloadKind[] = ["vocal", "instrumental"];

/**
 * "Include separated stems" (FR-93) is off: the blend would have to write two
 * files to this device against an explicit preference, so the fetch refuses
 * instead of doing it quietly. Already-resident stems still blend - this gate
 * is about new transfers only. The cog offers the one-tap opt-in and a retry.
 */
export class StemDownloadsDisabledError extends Error {
  constructor() {
    super("Stem downloads are turned off in the download settings.");
    this.name = "StemDownloadsDisabledError";
  }
}

/**
 * Safety net for a wait nobody ever resolves (both transfers cancelled by an
 * account switch, say): the subscription is released instead of leaking for
 * the process lifetime.
 */
const WAIT_TIMEOUT_MS = 15 * 60 * 1000;

const inFlight = new Map<SongKey, Promise<StemFiles>>();

const combinedProgress = (songKey: SongKey): number => {
  let total = 0;
  for (const kind of STEM_KINDS) total += getKindStatus(songKey, kind)?.progress ?? 0;
  return total / STEM_KINDS.length;
};

const erroredKind = (songKey: SongKey): DownloadKind | null => {
  for (const kind of STEM_KINDS) {
    if (getKindStatus(songKey, kind)?.status === "error") return kind;
  }
  return null;
};

const waitForStems = (
  song: Song,
  songKey: SongKey,
  onProgress: (fraction: number) => void,
): Promise<StemFiles> =>
  new Promise<StemFiles>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (fn: () => void): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      fn();
    };

    const check = (): void => {
      const files = residentFromLocalIndex(song);
      if (files) {
        settle(() => resolve(files));
        return;
      }
      const failed = erroredKind(songKey);
      if (failed) {
        settle(() => reject(new Error(`Stem download failed: ${failed}`)));
        return;
      }
      onProgress(combinedProgress(songKey));
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error("Stem download timed out.")));
    }, WAIT_TIMEOUT_MS);
    unsubscribe = subscribeDownloadStatus(check);
    check();
  });

const fetchStems = (
  song: Song,
  onProgress: (fraction: number) => void,
): Promise<StemFiles> => {
  const songKey = toSongKey(song.id);
  const existing = inFlight.get(songKey);
  if (existing) return existing;

  const run = (async (): Promise<StemFiles> => {
    if (!getDownloadSettings().includeStems) throw new StemDownloadsDisabledError();
    // Enqueue-time gates (WiFi refusal, no session, no stems) surface here.
    await downloadStemsForPlayback(song);
    const resident = residentFromLocalIndex(song);
    if (resident) return resident;
    return await waitForStems(song, songKey, onProgress);
  })();

  const tracked = run.finally(() => {
    inFlight.delete(songKey);
  });
  inFlight.set(songKey, tracked);
  return tracked;
};

export const stemFileProvider: StemFileProvider = {
  resident: residentFromLocalIndex,
  fetch: fetchStems,
};

/** downloads/register.ts installs this next to the LocalFileIndex. */
export const registerStemFileProvider = (): void => {
  setStemFileProvider(stemFileProvider);
};
