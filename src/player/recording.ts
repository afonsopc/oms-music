/**
 * Play recording accumulator (FR-62; DESIGN 8.5). A play event is recorded
 * once the user has actually LISTENED to min(30 s, duration/2), accumulated
 * from forward status deltas in (0, 2) s - seeks and source swaps never
 * count. Resets on song change AND natural end (repeats count again). Jam
 * songs never record; transferred-in seeds are pre-marked recorded (the
 * origin device counted them). Uma intervencao do DJ tambem nao: nao e uma
 * musica da biblioteca e o id dela nem existe no servidor. Fire-and-forget
 * POST via the injected fn.
 */
import type { SongId, SongKey } from "@/domain/ids";
import { toSongId, toSongKey } from "@/domain/ids";
import { isDjClip, type Song } from "@/domain/song";

export class ListenAccumulator {
  private songKey: SongKey | null = null;
  private accumulated = 0;
  private lastTime: number | null = null;
  private recorded = false;

  constructor(private readonly recordPlay: (songId: SongId) => void) {}

  /** Drive from every position status of the audible player. */
  onTime(song: Song | null, time: number, duration: number): void {
    if (!song || song.jam_song || isDjClip(song)) return;
    const key = toSongKey(song.id);
    if (this.songKey !== key) {
      this.songKey = key;
      this.accumulated = 0;
      this.lastTime = time;
      this.recorded = false;
      return;
    }
    if (!this.recorded && this.lastTime !== null) {
      const delta = time - this.lastTime;
      // Forward-only, small deltas: seeks and src swaps do not count.
      if (delta > 0 && delta < 2) this.accumulated += delta;
    }
    this.lastTime = time;
    if (this.recorded) return;
    const threshold =
      Number.isFinite(duration) && duration > 0 ? Math.min(30, duration / 2) : 30;
    if (this.accumulated >= threshold) {
      this.recorded = true;
      this.recordPlay(toSongId(key));
    }
  }

  /** Natural end: a replay under Loop One/All counts as a fresh play. */
  resetOnEnded(): void {
    this.accumulated = 0;
    this.lastTime = 0;
    this.recorded = false;
  }

  /**
   * Transfer seed (FR-62/FR-111): the seeded song was already counted by
   * the device it came from - never double-record it here.
   */
  markRecorded(songKey: SongKey): void {
    this.songKey = songKey;
    this.accumulated = 0;
    this.lastTime = null;
    this.recorded = true;
  }

  /** Logout wipe: no half-counted listen may cross an account switch. */
  reset(): void {
    this.songKey = null;
    this.accumulated = 0;
    this.lastTime = null;
    this.recorded = false;
  }
}
