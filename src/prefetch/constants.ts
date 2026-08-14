/**
 * Predictive prefetch tuning. Every number here is a trade-off with a
 * reason; changing one without changing its reason is how a prefetcher turns
 * into a battery and data leak.
 */

/**
 * Spotify P2P'10 starts next-track prefetch at 30 s remaining. We use 45 s
 * because we fetch WHOLE files, not a 15 s prefix: the extra head start is
 * what buys a gapless-feeling handover on a slow link. (The engine's own
 * FR-60 URL prefetch stays at 30 s - that one resolves a URL, this one moves
 * megabytes, so it needs to start earlier.)
 */
export const QUEUE_LOOKAHEAD_S = 45;

/** Rows past `last` that still get artwork: roughly one more viewport. */
export const ARTWORK_LOOKAHEAD_ROWS = 12;

export const MAX_AUDIO_WANTS = 3;
export const MAX_ARTWORK_WANTS = 24;

/** A fling crosses 40 rows. Nothing is enqueued until the scroll settles. */
export const SUPERSEDE_DEBOUNCE_MS = 700;

/** Opening a collection: let the screen's own queries land first. */
export const COLLECTION_START_DELAY_MS = 1_200;

/**
 * Above this, a superseded transfer is allowed to finish: the bytes are
 * nearly paid for, and throwing them away to chase the new viewport centre
 * would be the classic home-grown-prefetcher mistake in the OTHER direction.
 */
export const SUPERSEDE_MIN_PROGRESS = 0.5;
