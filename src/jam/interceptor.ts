/**
 * Proposal interception (FR-117). While FOLLOWING a jam whose `queue_mode`
 * is "everyone", pressing play on a library song is a proposal, not local
 * playback: the engine's interceptor seam consumes the transition before any
 * source is loaded, so nothing plays here and the host's queue grows.
 *
 * Entries already flagged `jam_song` are exempt: they belong to the host's
 * queue, are somebody else's rows, and proposing them back is nonsense.
 *
 * The interceptor is installed and removed by a jam-store subscription, so
 * the seam is empty the moment the rules change or the jam ends - a stale
 * interceptor would silently swallow every play.
 */
import { setPlaybackInterceptor, type PlaybackInterceptor } from "@/contracts/playbackInterceptor";
import type { SongId } from "@/domain/ids";
import { jamStore, selectCanPropose } from "./store";

export const createJamInterceptor = (propose: (songId: SongId) => void): PlaybackInterceptor => (
  song,
) => {
  if (song.jam_song) return false;
  propose(song.id);
  return true;
};

/**
 * Keeps `contracts/playbackInterceptor` in sync with the jam rules.
 * Returns the unsubscribe used by teardown/tests.
 */
export const installJamInterceptor = (propose: (songId: SongId) => void): (() => void) => {
  const interceptor = createJamInterceptor(propose);
  let installed = false;

  const sync = (): void => {
    const wanted = selectCanPropose(jamStore.getState());
    if (wanted === installed) return;
    installed = wanted;
    setPlaybackInterceptor(wanted ? interceptor : null);
  };

  sync();
  const unsubscribe = jamStore.subscribe(sync);
  return () => {
    unsubscribe();
    if (installed) setPlaybackInterceptor(null);
    installed = false;
  };
};
