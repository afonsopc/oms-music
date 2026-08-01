/**
 * In-memory fakes for the jam protocol tests (DESIGN 17: services take
 * injected fakes so protocol logic runs in CI without devices).
 */
import type {
  CableClient,
  CableState,
  CableSubscription,
  CableSubscriptionHandlers,
} from "@/cable/types";
import type { JamId, SongId, UserId } from "@/domain/ids";
import type { Jam, JamState, JamsIndex, SkipVoteResult } from "@/domain/jam";
import type { JamApi, JamRules } from "../channel";
import type { FollowerPlayerApi } from "../types";

export class FakeCable implements CableClient {
  readonly subscriptions: {
    params: Record<string, unknown>;
    handlers: CableSubscriptionHandlers;
    wakeHook: (() => void) | null;
    active: boolean;
  }[] = [];

  connect(): void {}
  disconnect(): void {}
  onStateChange(_cb: (s: CableState) => void): () => void {
    return () => {};
  }
  notifyForeground(): void {
    for (const entry of this.subscriptions) if (entry.active) entry.wakeHook?.();
  }

  subscribe(
    channelParams: Record<string, unknown>,
    handlers: CableSubscriptionHandlers,
  ): CableSubscription {
    const entry = { params: channelParams, handlers, wakeHook: null as (() => void) | null, active: true };
    this.subscriptions.push(entry);
    return {
      perform: () => {},
      unsubscribe: () => {
        entry.active = false;
      },
      setWakeHook: (fn) => {
        entry.wakeHook = fn;
      },
    };
  }

  /** The live subscription for a channel name, or null. */
  live(channel: string) {
    return (
      this.subscriptions.find((entry) => entry.active && entry.params.channel === channel) ?? null
    );
  }

  emit(channel: string, message: unknown): void {
    this.live(channel)?.handlers.onMessage(message);
  }

  reject(channel: string): void {
    this.live(channel)?.handlers.onReject?.();
  }
}

export class FakeFollower implements FollowerPlayerApi {
  readonly states: JamState[] = [];
  readonly ticks: { position: number; paused: boolean; songId: string | null }[] = [];
  localPaused = false;
  volume = 1;
  stops = 0;

  applyState(state: JamState): void {
    this.states.push(state);
  }
  applyTick(tick: { position: number; paused: boolean; songId: string | null }): void {
    this.ticks.push(tick);
  }
  setLocalPaused(paused: boolean): void {
    this.localPaused = paused;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  stop(): void {
    this.stops += 1;
  }
  destroy(): void {}
}

export interface FakeApiCalls {
  created: number;
  joined: JamId[];
  left: JamId[];
  ended: JamId[];
  invited: { id: JamId; userId: UserId }[];
  proposed: { id: JamId; songId: SongId }[];
  votes: JamId[];
  rules: { id: JamId; rules: JamRules }[];
}

export const createFakeApi = (
  overrides: Partial<JamApi> & { index?: JamsIndex; jam?: Jam; vote?: SkipVoteResult } = {},
): { api: JamApi; calls: FakeApiCalls } => {
  const calls: FakeApiCalls = {
    created: 0,
    joined: [],
    left: [],
    ended: [],
    invited: [],
    proposed: [],
    votes: [],
    rules: [],
  };
  const jam = overrides.jam;
  const api: JamApi = {
    getJams: () => Promise.resolve(overrides.index ?? { current: null, joinable: [] }),
    createJam: () => {
      calls.created += 1;
      return jam ? Promise.resolve(jam) : Promise.reject(new Error("no jam"));
    },
    joinJam: (id) => {
      calls.joined.push(id);
      return jam ? Promise.resolve(jam) : Promise.reject(new Error("no jam"));
    },
    leaveJam: (id) => {
      calls.left.push(id);
      return Promise.resolve(null);
    },
    endJam: (id) => {
      calls.ended.push(id);
      return Promise.resolve(null);
    },
    updateJamRules: (id, rules) => {
      calls.rules.push({ id, rules });
      return jam ? Promise.resolve({ ...jam, ...rules }) : Promise.reject(new Error("no jam"));
    },
    inviteToJam: (id, userId) => {
      calls.invited.push({ id, userId });
      return Promise.resolve(null);
    },
    proposeJamSong: (id, songId) => {
      calls.proposed.push({ id, songId });
      return Promise.resolve(null);
    },
    jamSkipVote: (id) => {
      calls.votes.push(id);
      return Promise.resolve(overrides.vote ?? { skipped: false, count: 1, needed: 2 });
    },
    ...overrides,
  };
  return { api, calls };
};
