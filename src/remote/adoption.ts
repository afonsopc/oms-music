/**
 * Snapshot adoption (FR-108 cold-start hydration + FR-111 transfer-in).
 *
 * Listener settings (rate, mode, EQ bands + enabled, separation flag, stem
 * volumes) travel with the ACCOUNT and are adopted on hydration and takeover;
 * `volume` is the one device-local output setting and is NEVER adopted.
 * Settings apply BEFORE the quartet so the initial source load already picks
 * the right node for the adopted playback mode (the web applies them in the
 * same render; imperatively that means settings first).
 *
 * The engine sanitizes every adopted quartet itself (jam proposals dropped
 * with remap, permutation validated, index clamped) and, for "activation",
 * marks the seeded song as already play-recorded (the origin device counted
 * it) - both per DESIGN 7.3/8.1.
 */
import type { PlaybackSnapshot, QueueState } from "@/domain/playback";
import type { RemoteEngine } from "./localPlayer";

export const quartetFromSnapshot = (snap: PlaybackSnapshot): QueueState => ({
  queue: snap.queue_songs ?? [],
  queueOrder: snap.queue_order ?? [],
  queueIndex: snap.queue_index ?? 0,
  shuffle: snap.shuffle ?? false,
});

/** True when the snapshot holds at least one adoptable (non-jam) song. */
export const hasAdoptableQueue = (snap: PlaybackSnapshot | null): boolean =>
  !!snap?.queue_songs?.some((s) => !s.jam_song);

/** Rate, mode, EQ, separation, stem volumes - never `volume` (FR-108/111). */
export const adoptListenerSettings = (engine: RemoteEngine, snap: PlaybackSnapshot): void => {
  if (typeof snap.playback_rate === "number") engine.setRate(snap.playback_rate);
  if (snap.playback_mode) engine.setPlaybackMode(snap.playback_mode);
  if (typeof snap.eq_low === "number") engine.setEqBand("low", snap.eq_low);
  if (typeof snap.eq_mid === "number") engine.setEqBand("mid", snap.eq_mid);
  if (typeof snap.eq_high === "number") engine.setEqBand("high", snap.eq_high);
  if (typeof snap.eq_enabled === "boolean") engine.setEqEnabled(snap.eq_enabled);
  if (typeof snap.separation_enabled === "boolean") {
    engine.setSeparationEnabled(snap.separation_enabled);
  }
  if (typeof snap.vocal_volume === "number") engine.setVocalVolume(snap.vocal_volume);
  if (typeof snap.instrumental_volume === "number") {
    engine.setInstrumentalVolume(snap.instrumental_volume);
  }
};

/**
 * Cold-start hydration (FR-108): adopt the snapshot as the local queue,
 * paused, seeked to the snapshot position ("continue where you left off").
 * The engine plants the paused activation seed itself (cause "hydration").
 */
export const adoptForHydration = (engine: RemoteEngine, snap: PlaybackSnapshot): void => {
  adoptListenerSettings(engine, snap);
  engine.setLoopMode(snap.loop_mode ?? "all");
  engine.adoptSnapshot(quartetFromSnapshot(snap), {
    position: snap.position ?? 0,
    paused: true,
    cause: "hydration",
  });
};

/**
 * Transfer-in promotion (FR-111): adopt queue + loop + listener settings
 * (never volume), honor the remote paused flag, seek to the remote position.
 * Returns whether the transfer resumes PLAYING audio (callers enter the
 * `activating` publish-suppression window in that case).
 */
export const adoptForActivation = (engine: RemoteEngine, snap: PlaybackSnapshot): boolean => {
  adoptListenerSettings(engine, snap);
  engine.setLoopMode(snap.loop_mode ?? "all");
  const paused = snap.paused ?? true;
  engine.adoptSnapshot(quartetFromSnapshot(snap), {
    position: snap.position ?? 0,
    paused,
    cause: "activation",
  });
  return !paused;
};
