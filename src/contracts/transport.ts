/**
 * Transport seam (DESIGN.md 13.3). EVERY UI surface and the lock screen call
 * this layer, never the engine directly. WP3 registers the engine as the base
 * transport; WP9 wraps it with the remote-aware decorator (controller ->
 * validated cable commands). The pre-registration default is an inert no-op
 * so packages can land in any order.
 */
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";

export interface TransportActions {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  setLoopMode(mode: LoopMode): void;
  setShuffle(on: boolean): void;
  setQueueIndex(visibleIndex: number): void;
  addToQueue(song: Song): void;
  playNext(song: Song): void;
  removeFromQueue(visibleIndex: number): void;
  reorderQueue(fromVisible: number, toVisible: number): void;
  setQueue(songs: Song[], startIndex?: number, opts?: { shuffle?: boolean }): void;
}

const noop = (): void => {};

const inertTransport: TransportActions = {
  play: noop,
  pause: noop,
  toggle: noop,
  next: noop,
  previous: noop,
  seek: noop,
  setVolume: noop,
  setRate: noop,
  setLoopMode: noop,
  setShuffle: noop,
  setQueueIndex: noop,
  addToQueue: noop,
  playNext: noop,
  removeFromQueue: noop,
  reorderQueue: noop,
  setQueue: noop,
};

let baseTransport: TransportActions = inertTransport;
let decorator: ((base: TransportActions) => TransportActions) | null = null;
let resolved: TransportActions = inertTransport;

const recompute = (): void => {
  resolved = decorator ? decorator(baseTransport) : baseTransport;
};

/** WP3: the engine registers itself as the base transport. */
export const setBaseTransport = (transport: TransportActions): void => {
  baseTransport = transport;
  recompute();
};

/** WP9: the remote layer decorates the base (or clears with null). */
export const setTransportDecorator = (
  d: ((base: TransportActions) => TransportActions) | null,
): void => {
  decorator = d;
  recompute();
};

/** The transport every surface calls. Resolve at call time, not at import. */
export const getTransport = (): TransportActions => resolved;
