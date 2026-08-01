/**
 * Failure bookkeeping for the recovery ladder (FR-61): the session-scoped
 * failed set, the one-recovery-attempt-per-song marker and the throttled
 * "song unavailable" toast. The ladder itself is driven by the engine; this
 * module keeps the state pure and unit-testable.
 *
 * The toast surfaces through a registered handler (the shell/UI package
 * registers one that translates the key); the default is a console warning
 * so the engine never imports the i18n runtime (kv-store) in CI.
 */
import type { SongKey } from "@/domain/ids";

export const FAILURE_TOAST_THROTTLE_MS = 3000;

/** i18n key for the throttled toast; already in all three catalogs. */
export const SONG_UNAVAILABLE_TOAST_KEY =
  "components.music.MusicProvider.songUnavailableSkipped";

export type PlayerToastHandler = (messageKey: string) => void;

let toastHandler: PlayerToastHandler = (key) => {
  console.warn(`[player] ${key}`);
};

/** The shell registers the real toast (translating the key through t()). */
export const setPlayerToastHandler = (handler: PlayerToastHandler): void => {
  toastHandler = handler;
};

export class RecoveryTracker {
  private readonly failed = new Set<SongKey>();
  private recoveryAttemptSongKey: SongKey | null = null;
  private lastToastAt = 0;
  private onFailedSetChanged: ((keys: ReadonlySet<SongKey>) => void) | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  setFailedSetListener(cb: (keys: ReadonlySet<SongKey>) => void): void {
    this.onFailedSetChanged = cb;
  }

  /**
   * First stream error for a song returns true (attempt an in-place
   * recovery); a repeat for the same song returns false (mark and advance).
   */
  beginRecoveryAttempt(songKey: SongKey): boolean {
    if (this.recoveryAttemptSongKey === songKey) return false;
    this.recoveryAttemptSongKey = songKey;
    return true;
  }

  markFailed(songKey: SongKey): void {
    if (!this.failed.has(songKey)) {
      this.failed.add(songKey);
      this.onFailedSetChanged?.(this.failed);
    }
    const at = this.now();
    if (at - this.lastToastAt > FAILURE_TOAST_THROTTLE_MS) {
      this.lastToastAt = at;
      toastHandler(SONG_UNAVAILABLE_TOAST_KEY);
    }
  }

  /** A song that audibly plays is proven good again. */
  clearFailed(songKey: SongKey): void {
    if (this.failed.delete(songKey)) {
      this.onFailedSetChanged?.(this.failed);
    }
  }

  hasFailed(songKey: SongKey): boolean {
    return this.failed.has(songKey);
  }

  get failedKeys(): ReadonlySet<SongKey> {
    return this.failed;
  }
}
