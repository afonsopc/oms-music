/**
 * Remote-aware transport decorator (DESIGN 13.3 + FR-109/111, FR-63 remote
 * half). Registered into `contracts/transport` on top of the engine, so
 * EVERY surface - buttons, sheets, the queue screen and the lock screen -
 * automatically drives the ACTIVE device instead of the silent local one.
 *
 * Mapping:
 * - controller: transport calls become validated `command` sends (the
 *   server's vocabulary, args exactly as documented in playback-core 10.5);
 * - no_active + play/toggle: claim `if_none` (pessimistic; a claim_rejected
 *   demotes) and resume locally right away;
 * - setQueue anywhere but the active device: a TAKEOVER, never a command -
 *   `claim_active {steal}` (optimistic) then play the new queue locally;
 * - device-LOCAL settings (rate, playback mode, EQ, stem volumes) never
 *   cross the wire; volume DOES (it is the active device's output).
 */
import type { TransportActions } from "@/contracts/transport";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import type { LocalPlaybackState, RemoteEngine } from "./localPlayer";
import { normalizeWireSongId } from "./snapshot";
import { remoteStore } from "./store";

export interface RemoteTransportDeps {
  engine: RemoteEngine;
  localState: LocalPlaybackState;
  sendCommand(command: string, args?: Record<string, unknown>): void;
  claimActive(mode: "if_none" | "steal"): void;
  /** Flags the promotion as self-initiated (no snapshot re-adoption). */
  markTakeover(): void;
  markSelfClaim(): void;
}

const isController = (): boolean => remoteStore.getState().role === "controller";
const isNoActive = (): boolean => remoteStore.getState().role === "no_active";

/** Song ids ride the cable as strings (DESIGN 4 / playback-core 16.3). */
const wireSongId = (song: Song): string => String(song.id);

export const createRemoteTransportDecorator =
  (deps: RemoteTransportDeps) =>
  (base: TransportActions): TransportActions => {
    /**
     * Resume locally, re-resolving the source if a controller stint cleared
     * it. `stopAndClearSource()` FROZE the local store position at the moment
     * this device went silent, so `playFromIdle` alone would restart where
     * this device left off instead of where the other device got to. The web
     * seeds pendingSeek from the remote snapshot (MusicProvider
     * `playFromIdle`) and so do we: with no source loaded `engine.seek()`
     * only plants pendingSeek + the store position, which playFromIdle then
     * picks up. Guarded on the snapshot describing the SAME song, otherwise
     * the local position is the honest one.
     */
    const playLocally = (): void => {
      if (!deps.engine.hasLoadedSource()) {
        const snapshot = remoteStore.getState().snapshot;
        const position = snapshot?.position;
        const current = deps.engine.getCurrentSong();
        if (
          typeof position === "number" &&
          Number.isFinite(position) &&
          position > 0 &&
          current !== null &&
          normalizeWireSongId(snapshot?.song_id) === normalizeWireSongId(current.id)
        ) {
          deps.engine.seek(position);
        }
      }
      deps.engine.playFromIdle();
    };

    const claimAndPlay = (): void => {
      deps.markSelfClaim();
      deps.claimActive("if_none");
      playLocally();
    };

    return {
      play: () => {
        if (isController()) return deps.sendCommand("play");
        if (isNoActive()) return claimAndPlay();
        playLocally();
      },
      pause: () => {
        if (isController()) return deps.sendCommand("pause");
        base.pause();
      },
      toggle: () => {
        if (isController()) return deps.sendCommand("toggle");
        if (isNoActive() && !deps.localState.getState().playing) return claimAndPlay();
        base.toggle();
      },
      next: () => {
        if (isController()) return deps.sendCommand("next");
        base.next();
      },
      previous: () => {
        if (isController()) return deps.sendCommand("previous");
        base.previous();
      },
      seek: (seconds: number) => {
        if (isController()) return deps.sendCommand("seek", { time: Math.max(0, seconds) });
        base.seek(seconds);
      },
      setVolume: (volume: number) => {
        // The one shared output setting: a controller drag moves the ACTIVE
        // device's volume, never this silent one.
        if (isController()) return deps.sendCommand("set_volume", { volume });
        base.setVolume(volume);
      },
      // Device-local listener settings: always local, greyed out in the UI
      // while controlling (they still ride state_changed as settings).
      setRate: (rate: number) => base.setRate(rate),
      setLoopMode: (mode: LoopMode) => {
        if (isController()) return deps.sendCommand("set_loop_mode", { mode });
        base.setLoopMode(mode);
      },
      setShuffle: (on: boolean) => {
        if (isController()) return deps.sendCommand("set_shuffle", { shuffle: on });
        base.setShuffle(on);
      },
      setQueueIndex: (visibleIndex: number) => {
        if (isController()) return deps.sendCommand("set_queue_index", { index: visibleIndex });
        base.setQueueIndex(visibleIndex);
      },
      addToQueue: (song: Song) => {
        // Commands carry ids only: the active device owns the library.
        if (isController()) return deps.sendCommand("add_to_queue", { song_id: wireSongId(song) });
        base.addToQueue(song);
      },
      playNext: (song: Song) => {
        if (isController()) return deps.sendCommand("play_next", { song_id: wireSongId(song) });
        base.playNext(song);
      },
      removeFromQueue: (visibleIndex: number) => {
        if (isController()) {
          return deps.sendCommand("remove_from_queue", { visible_index: visibleIndex });
        }
        base.removeFromQueue(visibleIndex);
      },
      reorderQueue: (fromVisible: number, toVisible: number) => {
        if (isController()) {
          return deps.sendCommand("reorder_queue", { from: fromVisible, to: toVisible });
        }
        base.reorderQueue(fromVisible, toVisible);
      },
      setQueue: (songs: Song[], startIndex?: number, opts?: { shuffle?: boolean }) => {
        // Replacing the queue makes THIS device the player, exactly like
        // pressing play on a second Spotify device.
        if (isController() || isNoActive()) {
          deps.markTakeover();
          deps.claimActive("steal");
        }
        base.setQueue(songs, startIndex, opts);
      },
    };
  };
