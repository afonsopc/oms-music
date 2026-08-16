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

/**
 * How long a recovered song must play audibly before it EARNS a fresh
 * recovery attempt. Long enough that a play-for-a-second-then-die stream
 * still marks failed and advances (no infinite recover loop), short enough
 * that the second presigned-URL expiry hours into a repeat-one session gets
 * an in-place recovery instead of a skip.
 */
export const PROVEN_AUDIBLE_MS = 10_000;

/** i18n key for the throttled toast; already in all three catalogs. */
export const SONG_UNAVAILABLE_TOAST_KEY =
  "components.music.MusicProvider.songUnavailableSkipped";

/** Web: a política de autoplay recusou o arranque; o play manual resolve. */
export const AUTOPLAY_BLOCKED_TOAST_KEY =
  "components.music.MusicProvider.autoplayBlocked";

export type PlayerToastHandler = (messageKey: string) => void;

let toastHandler: PlayerToastHandler = (key) => {
  console.warn(`[player] ${key}`);
};

/** The shell registers the real toast (translating the key through t()). */
export const setPlayerToastHandler = (handler: PlayerToastHandler): void => {
  toastHandler = handler;
};

/** Canal directo para avisos do player fora do tracker (ex.: autoplay). */
export const playerToast = (messageKey: string): void => {
  toastHandler(messageKey);
};

export class RecoveryTracker {
  private readonly failed = new Set<SongKey>();
  private recoveryAttemptSongKey: SongKey | null = null;
  private recoveryAttemptAt = 0;
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
    this.recoveryAttemptAt = this.now();
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

  /**
   * Proven audible: after PROVEN_AUDIBLE_MS of playback the recovery worked,
   * so the song has EARNED a fresh attempt for its next failure. Without
   * this, the marker made recovery a once-per-song affair - the second
   * presigned-URL expiry hours later (long session, repeat-one) skipped the
   * song instead of re-minting a URL. The time gate keeps the flip side: a
   * stream that plays for a second and dies again still marks failed.
   */
  noteAudible(songKey: SongKey): void {
    if (this.recoveryAttemptSongKey !== songKey) return;
    if (this.now() - this.recoveryAttemptAt < PROVEN_AUDIBLE_MS) return;
    this.recoveryAttemptSongKey = null;
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

  /** Logout wipe: the failed set is session-scoped, never account-scoped. */
  reset(): void {
    this.recoveryAttemptSongKey = null;
    this.lastToastAt = 0;
    if (this.failed.size === 0) return;
    this.failed.clear();
    this.onFailedSetChanged?.(this.failed);
  }

  get failedKeys(): ReadonlySet<SongKey> {
    return this.failed;
  }
}
