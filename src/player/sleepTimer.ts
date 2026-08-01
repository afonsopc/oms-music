/**
 * Sleep timer (FR-64): minutes (5/10/15/30/60 in the UI) via a timeout, or
 * an end-of-song one-shot consumed by the engine's ended handler. Never
 * persisted, never synced. The engine injects the pause + state callbacks.
 */
import type { SleepTimerSetting } from "./types";

export type SleepTimerState =
  | { minutes: number; endsAt: number }
  | { endOfSong: true }
  | null;

export class SleepTimer {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private state: SleepTimerState = null;

  constructor(
    private readonly onFire: () => void,
    private readonly onStateChange: (state: SleepTimerState) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get current(): SleepTimerState {
    return this.state;
  }

  set(setting: SleepTimerSetting): void {
    this.clearTimeout();
    if (setting === null) {
      this.update(null);
      return;
    }
    if ("endOfSong" in setting) {
      this.update({ endOfSong: true });
      return;
    }
    const ms = setting.minutes * 60 * 1000;
    this.update({ minutes: setting.minutes, endsAt: this.now() + ms });
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      this.update(null);
      this.onFire();
    }, ms);
  }

  /**
   * Called from the engine's ended handler. Returns true when an end-of-song
   * timer was pending: the engine suppresses the next track's autoplay and
   * this module fires the pause + clears.
   */
  consumeEndOfSong(): boolean {
    if (this.state === null || !("endOfSong" in this.state)) return false;
    this.update(null);
    this.onFire();
    return true;
  }

  dispose(): void {
    this.clearTimeout();
    this.state = null;
  }

  private update(state: SleepTimerState): void {
    this.state = state;
    this.onStateChange(state);
  }

  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
