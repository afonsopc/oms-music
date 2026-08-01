/**
 * The local-player bridge the remote layer codes against. Runtime wiring
 * happens in remote/register.ts (the composition root): the protocol modules
 * (channel, publisher, controller, adoption, commands, transport) only ever
 * see these interfaces, so they stay unit-testable with fakes and free of
 * runtime imports from src/player (type-only imports carry no dependency).
 */
import type { PlayerEngine, PlayerEngineExtras } from "@/player/types";
import type { PlayerStoreState } from "@/player/store";

/** The engine surface WP3 exposes to WP9 (frozen 7.3 API + additive extras). */
export type RemoteEngine = PlayerEngine & PlayerEngineExtras;

/** Read + subscribe view of the local player store (the zustand mirror). */
export interface LocalPlaybackState {
  getState(): PlayerStoreState;
  subscribe(cb: (state: PlayerStoreState, prev: PlayerStoreState) => void): () => void;
}
