/**
 * The predictive prefetch POLICY: signals in, a ranked want list out.
 *
 * Deterministic, no clock, no I/O, no platform. Everything that could make
 * this function lie (network gates, residency, in-flight transfers, the
 * session budget) is resolved by the driver BEFORE calling it and handed in
 * as plain data, so the only thing left to test is the arbitration itself.
 *
 * The arbitration is the Media3 distance ladder collapsed onto our two signal
 * sources, and it is one comparison:
 *
 *   - a GAP IN PLAYBACK is a worse defect than a slow tap, so the next queue
 *     track outranks everything while the current one is nearly over;
 *   - but ~39 % of Spotify playbacks are random access, so the browse want
 *     must not be starved the other 95 % of the time.
 *
 * Gating `queue-next` on `remainingS <= QUEUE_LOOKAHEAD_S` gives it rank 0
 * for the last 45 s of every track and gives the browse want rank 0 for the
 * rest. That is the whole thing.
 */
import { MAX_ARTWORK_WANTS, MAX_AUDIO_WANTS, ARTWORK_LOOKAHEAD_ROWS, QUEUE_LOOKAHEAD_S } from "./constants";
import { wantKey, type PrefetchSignals, type PrefetchSong, type PrefetchWant, type WantKind, type WantReason } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Push-with-eligibility. A want is dropped when the song is a jam proposal,
 * when the media id it would need is missing, when the bytes are already
 * resident or in flight, or when a BETTER rank already claimed the same
 * (songKey, kind) - the dedup keeps the first push, and pushes happen in
 * rank order, so first-wins IS best-wins.
 *
 * `rank` only advances when a want is actually accepted: an ineligible
 * candidate must not leave a hole in the ranking, because the driver reads
 * "the rank 0 audio want" literally.
 */
const pusher = (signals: PrefetchSignals, out: PrefetchWant[]) => {
  const seen = new Set<string>();
  let rank = 0;
  return (song: PrefetchSong | undefined | null, kind: WantKind, reason: WantReason): void => {
    if (!song) return;
    if (song.jam) return;
    const mediaId = kind === "audio" ? song.audioMediaId : song.artworkMediaId;
    if (!mediaId) return;
    const key = wantKey(song.songKey, kind);
    if (seen.has(key)) return;
    if (signals.resident.has(key)) return;
    seen.add(key);
    out.push({ rank: rank++, kind, songKey: song.songKey, mediaId, reason });
  };
};

export const computeWants = (s: PrefetchSignals): PrefetchWant[] => {
  const wants: PrefetchWant[] = [];
  const push = pusher(s, wants);

  // --- Step 1: audio, in ladder order. -------------------------------------
  const queue = s.queue;
  if (
    queue &&
    !queue.loopOne &&
    queue.remainingS != null &&
    queue.remainingS <= QUEUE_LOOKAHEAD_S
  ) {
    push(queue.songs[queue.currentIndex + 1], "audio", "queue-next");
  }

  const collection = s.collection;
  if (collection && collection.songs.length > 0) {
    // centerIndex null means "the list has not scrolled / geometry unknown",
    // which is exactly the just-opened-a-playlist case: target row 0 and the
    // owner's first acceptance criterion falls out for free.
    const unknownCenter = s.viewport.centerIndex == null;
    const index = clamp(s.viewport.centerIndex ?? 0, 0, collection.songs.length - 1);
    push(
      collection.songs[index],
      "audio",
      unknownCenter ? "collection-first" : "viewport-center",
    );
  }

  if (queue && queue.currentIndex > 0) {
    push(queue.songs[queue.currentIndex - 1], "audio", "queue-prev");
  }

  // --- Step 2: artwork over the visible range plus one viewport. -----------
  // Artwork only, never audio, for the RANGE: a fling generates enormous
  // candidate churn and audio prefetch there is pure waste. Covers are 100x
  // smaller and land in the image cache's own budget.
  if (collection && s.viewport.first != null && s.viewport.last != null) {
    const n = collection.songs.length;
    const first = clamp(s.viewport.first, 0, Math.max(0, n - 1));
    const last = clamp(s.viewport.last + ARTWORK_LOOKAHEAD_ROWS, 0, Math.max(0, n - 1));
    for (let i = first; i <= last; i += 1) {
      push(collection.songs[i], "artwork", "viewport-artwork");
    }
  }

  // --- Step 3: caps, rank order preserved, audio first. --------------------
  const audio: PrefetchWant[] = [];
  const artwork: PrefetchWant[] = [];
  for (const want of wants) {
    if (want.kind === "audio") {
      if (audio.length < MAX_AUDIO_WANTS) audio.push(want);
    } else if (artwork.length < MAX_ARTWORK_WANTS) {
      artwork.push(want);
    }
  }
  return [...audio, ...artwork];
};
