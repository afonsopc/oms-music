/**
 * The seven-input truth table that decides whether predictive transfers may
 * run AT ALL. Pure, so the whole table is a bun test rather than a device
 * session.
 *
 * All of these are read ONCE, at the driver's fire time, never per want: the
 * per-song NetInfo round trip is exactly what the 2026-08-14 freeze report
 * killed, and re-introducing it inside a want loop would undo that fix while
 * looking like an unrelated feature.
 */
export interface PrefetchGates {
  /** The GO OFFLINE switch. Halts every background transfer. */
  manualOffline: boolean;
  online: boolean;
  /** settings.wifiOnly || settings.predictiveWifiOnly. */
  wifiOnly: boolean;
  /** Last NetInfo snapshot type === "wifi". */
  onWifi: boolean;
  /**
   * Last NetInfo `isConnectionExpensive`. This is our BATTERY proxy: a real
   * battery gate would need expo-battery, a new dependency, which is out of
   * scope. Stated rather than silently omitted.
   */
  metered: boolean;
  sessionBudgetExhausted: boolean;
  /**
   * Explicit (user-requested) transfers in flight. Predictive is SUSPENDED
   * while any of them run rather than being given a lower priority: the
   * scheduler is FIFO with concurrency 3, so a predictive want let in during
   * a 250-song collection sync would queue behind 250 items anyway.
   * Suspension is simpler, is correct, and introduces no priority queue.
   */
  explicitInFlight: number;
  /** settings.predictiveEnabled, default true. */
  predictiveEnabled: boolean;
}

export const prefetchAllowed = (g: PrefetchGates): boolean =>
  g.predictiveEnabled &&
  g.online &&
  !g.manualOffline &&
  !(g.wifiOnly && !g.onWifi) &&
  !g.metered &&
  !g.sessionBudgetExhausted &&
  g.explicitInFlight === 0;
