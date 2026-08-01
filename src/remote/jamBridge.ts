/**
 * Jam command seam. Server-built commands on the host's playback stream
 * (`jam_add_song`, and `next` fired by a passed skip vote) route to WP10's
 * jam/hostDuties.ts once it registers here (via boot wireup). Until then the
 * channel falls back to the engine directly: `insertJamProposal` already
 * implements the FIFO insert-after-current rule, and `next` is the ordinary
 * transport next - so proposals keep working even before WP10 lands.
 */
import type { Song } from "@/domain/song";

export interface JamCommandHandler {
  /** Server-injected proposal payload (presigned audio_url + jam_proposer). */
  onJamAddSong(song: Song): void;
  /** Server-built skip (vote passed / host voted). */
  onNext(): void;
}

let handler: JamCommandHandler | null = null;

/** WP10 registers its host duties; null restores the engine fallback. */
export const setJamCommandHandler = (h: JamCommandHandler | null): void => {
  handler = h;
};

export const getJamCommandHandler = (): JamCommandHandler | null => handler;
