/**
 * FR-63 lock-screen next/previous routing, driven by a fake emitter (the real
 * one is MPRemoteCommandCenter, which no CI machine has). The router must:
 * route each native event to the transport kind, mirror lock-screen
 * activation onto the native enable flag without redundant calls, and go
 * completely quiet after stop().
 */
import { describe, expect, it } from "bun:test";
import {
  createRemoteTrackRouter,
  inertRemoteTrackRouter,
  type RemoteTrackCommands,
  type RemoteTrackEvent,
  type RemoteTrackSubscription,
} from "../remoteTrackCommands";

class FakeRemoteTrackCommands implements RemoteTrackCommands {
  readonly enableCalls: boolean[] = [];
  private readonly listeners = new Map<RemoteTrackEvent, Set<() => void>>();

  addListener(event: RemoteTrackEvent, listener: () => void): RemoteTrackSubscription {
    const bucket = this.listeners.get(event) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    return {
      remove: () => {
        bucket.delete(listener);
      },
    };
  }

  setEnabled(enabled: boolean): void {
    this.enableCalls.push(enabled);
  }

  /** Simulates a lock-screen button press. */
  emit(event: RemoteTrackEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }

  listenerCount(): number {
    let total = 0;
    for (const bucket of this.listeners.values()) total += bucket.size;
    return total;
  }
}

const setup = (): {
  native: FakeRemoteTrackCommands;
  routed: ("next" | "previous")[];
  router: ReturnType<typeof createRemoteTrackRouter>;
} => {
  const native = new FakeRemoteTrackCommands();
  const routed: ("next" | "previous")[] = [];
  const router = createRemoteTrackRouter(native, (kind) => routed.push(kind));
  return { native, routed, router };
};

describe("createRemoteTrackRouter", () => {
  it("routes the two native events to the transport kinds", () => {
    const { native, routed } = setup();
    native.emit("nextTrack");
    native.emit("previousTrack");
    native.emit("nextTrack");
    expect(routed).toEqual(["next", "previous", "next"]);
  });

  it("subscribes exactly once per event", () => {
    const { native, routed } = setup();
    expect(native.listenerCount()).toBe(2);
    native.emit("nextTrack");
    expect(routed).toEqual(["next"]);
  });

  it("reports availability and starts with the buttons untouched", () => {
    const { native, router } = setup();
    expect(router.available).toBe(true);
    expect(native.enableCalls).toEqual([]);
  });

  it("mirrors lock-screen activation and never repeats an identical call", () => {
    const { native, router } = setup();
    router.setActive(true);
    router.setActive(true);
    router.setActive(false);
    router.setActive(false);
    router.setActive(true);
    expect(native.enableCalls).toEqual([true, false, true]);
  });

  it("stop() disables the buttons, drops the listeners and stops routing", () => {
    const { native, routed, router } = setup();
    router.setActive(true);
    router.stop();
    expect(native.enableCalls).toEqual([true, false]);
    expect(native.listenerCount()).toBe(0);
    native.emit("nextTrack");
    native.emit("previousTrack");
    expect(routed).toEqual([]);
  });

  it("is idempotent after stop()", () => {
    const { native, router } = setup();
    router.setActive(true);
    router.stop();
    router.stop();
    router.setActive(true);
    expect(native.enableCalls).toEqual([true, false]);
  });

  it("falls back to the inert router when the native module is absent", () => {
    const routed: string[] = [];
    const router = createRemoteTrackRouter(null, (kind) => routed.push(kind));
    expect(router).toBe(inertRemoteTrackRouter);
    expect(router.available).toBe(false);
    router.setActive(true);
    router.stop();
    expect(routed).toEqual([]);
  });
});
