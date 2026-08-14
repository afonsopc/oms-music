/**
 * Stem file provisioning seam (DESIGN 16.1 amendment 2026-08-03).
 *
 * The native mixers play LOCAL files only (iOS `AVAudioFile` cannot open a
 * remote URL; two independent progressive streams that must never underrun
 * relative to each other double the failure surface on Android), so both
 * stems have to be fully on disk before the blend can play - the same
 * constraint the web meets by fetching and decoding both stems whole before
 * muting the original (frontend/lib/vocalSeparation.ts:163-197).
 *
 * The default provider answers from the LocalFileIndex only, so a downloaded
 * song blends instantly and everything else reports "not resident" instead of
 * playing a half mix. `src/downloads` installs the fetching provider, which
 * enqueues the two stem transfers and reports combined progress while the
 * plain mix keeps playing.
 */
import { toSongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { getLocalFileIndex } from "./localSource";

export interface StemFiles {
  /** file:// uri of the vocals stem. */
  vocalsUri: string;
  /** file:// uri of the instrumental stem. */
  instrumentalUri: string;
}

/** Thrown by the default provider: nothing in this build can fetch stems. */
export class StemFetchUnavailableError extends Error {
  constructor() {
    super("Stem downloads unavailable.");
    this.name = "StemFetchUnavailableError";
  }
}

export interface StemFileProvider {
  /** Synchronous: both stems already on disk, or null. Never fetches. */
  resident(song: Song): StemFiles | null;
  /**
   * Fetch both stems to local disk, joining an in-flight fetch for the same
   * song. `onProgress` reports 0..1 across BOTH files. Rejects when either
   * transfer fails, so the caller can fall back to the plain mix.
   */
  fetch(song: Song, onProgress: (fraction: number) => void): Promise<StemFiles>;
}

const residentFromLocalIndex = (song: Song): StemFiles | null => {
  // Stems only exist as fs nodes on the song; a jam proposal never has them.
  if (song.audio_url) return null;
  if (!song.vocals_media_id || !song.instrumental_media_id) return null;
  const index = getLocalFileIndex();
  const key = toSongKey(song.id);
  const vocalsUri = index.get(key, "vocal");
  const instrumentalUri = index.get(key, "instrumental");
  if (!vocalsUri || !instrumentalUri) return null;
  return { vocalsUri, instrumentalUri };
};

const localOnlyProvider: StemFileProvider = {
  resident: residentFromLocalIndex,
  fetch: () => Promise.reject(new StemFetchUnavailableError()),
};

let current: StemFileProvider = localOnlyProvider;

/** downloads/register.ts installs the fetching provider here. */
export const setStemFileProvider = (provider: StemFileProvider | null): void => {
  current = provider ?? localOnlyProvider;
};

export const getStemFileProvider = (): StemFileProvider => current;

/** Exported so the fetching provider reuses ONE resident-check definition. */
export { residentFromLocalIndex };
