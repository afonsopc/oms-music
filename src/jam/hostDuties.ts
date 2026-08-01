/**
 * Jam host duties (FR-116). A member's proposal is NOT queued in the
 * database: the server broadcasts a server-built `jam_add_song` command with
 * a fully presigned song payload to the HOST's active playback device, and
 * that device does the queueing. A host client that ignores the command
 * breaks proposals for the whole jam.
 *
 * Placement is FIFO: right after the current song but BEHIND any proposals
 * already waiting, which is exactly `queueOps.insertJamProposal` (WP3).
 *
 * The three independent jam guards keyed off `jam_song` live in
 * player/recording.ts (never play-recorded), downloads/manager.ts (never
 * downloaded) and queueOps.sanitizeSnapshot (dropped from every adoption).
 * They all read the flag off the song, so this handler NORMALIZES the
 * incoming payload to carry `jam_song: true` even if a future server build
 * omitted it - the guards must never depend on the wire being perfect.
 * Separation is refused for the same reason (separation/register.ts).
 */
import type { Song } from "@/domain/song";
import type { JamCommandHandler } from "@/remote/jamBridge";

/** The slice of the engine the host duties touch (fakeable in tests). */
export interface JamHostEngine {
  insertJamProposal(song: Song): void;
  next(cause?: "user"): void;
}

/**
 * Marks a server-built proposal as a jam song. Presigned `audio_url` is used
 * verbatim by the source ladder (the host cannot resolve the proposer's fs
 * nodes - they would 404).
 */
export const normalizeProposal = (song: Song): Song => ({
  ...song,
  jam_song: true,
});

export const createJamCommandHandler = (engine: JamHostEngine): JamCommandHandler => ({
  onJamAddSong: (song) => {
    if (!song || typeof song !== "object") return;
    engine.insertJamProposal(normalizeProposal(song));
  },
  // A passed skip vote arrives as a server-built `next` for the host's
  // active device: the ordinary transport next, played immediately.
  onNext: () => engine.next("user"),
});
