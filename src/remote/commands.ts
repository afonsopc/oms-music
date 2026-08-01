/**
 * Command router (FR-109/110 executor half): the full PlaybackChannel
 * vocabulary, executed ONLY when this device is the target (the channel
 * checks `target_device_id` before calling in). Each command runs the same
 * local implementation a user tap would - the engine - and the active
 * publisher rebroadcasts the resulting truth.
 *
 * `add_to_queue`/`play_next` are id-only on the wire; the active device
 * resolves them locally: queue first (never jam entries), then the query
 * cache, then `GET /songs/:id` as the last resort. The cache/REST half is
 * INJECTED (remote/songResolver.ts, wired by register.ts) so the router
 * itself stays free of api imports and runs in bun without react-native.
 */
import { toSongId } from "@/domain/ids";
import type { SongId } from "@/domain/ids";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { getJamCommandHandler } from "./jamBridge";
import type { LocalPlaybackState, RemoteEngine } from "./localPlayer";
import { planOrderMoves } from "./orderPlan";

const isLoopMode = (v: unknown): v is LoopMode => v === "none" || v === "one" || v === "all";

const asInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

// Re-exported so callers keep one import site for the command vocabulary.
export { planOrderMoves };

/** Cache/REST lookup, registered by remote/register.ts at boot. */
export type RemoteSongLookup = (songId: SongId) => Promise<Song | null>;

let songLookup: RemoteSongLookup | null = null;

export const setRemoteSongLookup = (lookup: RemoteSongLookup | null): void => {
  songLookup = lookup;
};

/** Queue (non-jam) -> the registered cache/REST lookup. */
export const resolveSongById = async (
  engine: RemoteEngine,
  songId: SongId,
): Promise<Song | null> => {
  const inQueue = engine
    .getQueueState()
    .queue.find((s) => s.id === songId && !s.jam_song);
  if (inQueue) return inQueue;
  if (!songLookup) return null;
  try {
    return await songLookup(songId);
  } catch {
    return null;
  }
};

const looksLikeSong = (v: unknown): v is Song =>
  !!v &&
  typeof v === "object" &&
  typeof (v as Song).title === "string" &&
  (typeof (v as Song).id === "number" || typeof (v as Song).id === "string");

export const executeRemoteCommand = (
  engine: RemoteEngine,
  localState: LocalPlaybackState,
  command: string,
  args: Record<string, unknown> | undefined,
): void => {
  switch (command) {
    case "play":
      engine.playFromIdle();
      return;
    case "pause":
      engine.pause();
      return;
    case "toggle":
      if (localState.getState().playing) engine.pause();
      else engine.playFromIdle();
      return;
    case "seek": {
      const time = Number(args?.time ?? 0);
      if (Number.isFinite(time)) engine.seek(Math.max(0, time));
      return;
    }
    case "next": {
      // Server-built next (jam skip) routes to the jam seam when registered;
      // it is the ordinary transport next either way.
      const jam = getJamCommandHandler();
      if (jam) jam.onNext();
      else engine.next("user");
      return;
    }
    case "previous":
      engine.previous();
      return;
    case "set_queue_index": {
      const index = asInt(args?.index);
      if (index !== null && index >= 0) engine.setQueueIndex(index);
      return;
    }
    case "set_queue_order": {
      const order = args?.order;
      if (!Array.isArray(order) || !order.every((n) => Number.isInteger(n) && n >= 0)) return;
      const moves = planOrderMoves(engine.getQueueState().queueOrder, order as number[]);
      if (!moves) return;
      for (const move of moves) engine.reorderQueue(move.from, move.to);
      return;
    }
    case "set_shuffle":
      engine.setShuffle(!!args?.shuffle);
      return;
    case "set_loop_mode": {
      const mode = args?.mode;
      if (isLoopMode(mode)) engine.setLoopMode(mode);
      return;
    }
    case "set_volume": {
      const volume = Number(args?.volume);
      if (Number.isFinite(volume)) engine.setVolume(volume);
      return;
    }
    case "add_to_queue":
    case "play_next": {
      const raw = args?.song_id;
      if (raw === null || raw === undefined) return;
      const songId = toSongId(String(raw));
      if (!Number.isFinite(songId)) return;
      const isPlayNext = command === "play_next";
      void resolveSongById(engine, songId).then((song) => {
        if (!song) return;
        if (isPlayNext) engine.playNext(song);
        else engine.addToQueue(song);
      });
      return;
    }
    case "remove_from_queue": {
      const visibleIndex = asInt(args?.visible_index);
      if (visibleIndex !== null && visibleIndex >= 0) engine.removeFromQueue(visibleIndex);
      return;
    }
    case "reorder_queue": {
      const from = asInt(args?.from);
      const to = asInt(args?.to);
      if (from !== null && to !== null && from >= 0 && to >= 0) {
        engine.reorderQueue(from, to);
      }
      return;
    }
    case "jam_add_song": {
      // Server-built only (never in the client vocabulary): a member's
      // proposal for the hosting device. FIFO placement after the current
      // song, behind earlier pending proposals.
      const song = args?.song;
      if (!looksLikeSong(song)) return;
      const jam = getJamCommandHandler();
      if (jam) jam.onJamAddSong(song);
      else engine.insertJamProposal(song);
      return;
    }
    default:
      // Unknown commands are server-validated away; ignore defensively.
      return;
  }
};
