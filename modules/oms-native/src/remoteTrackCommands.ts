/**
 * Pure JS half of the lock-screen track commands (FR-63): the shape of the
 * native seam plus the router that turns its events into transport calls.
 *
 * Deliberately import-free so it loads under bun in CI (anything that reaches
 * expo-modules-core drags react-native in and cannot be unit tested here).
 * The native accessor lives next door in OmsNative.ts.
 */

export type RemoteTrackEvent = "nextTrack" | "previousTrack";

export interface RemoteTrackSubscription {
  remove(): void;
}

/** The native surface, narrowed to what the router needs. */
export interface RemoteTrackCommands {
  addListener(event: RemoteTrackEvent, listener: () => void): RemoteTrackSubscription;
  /** Shows / hides the two lock-screen buttons (iOS: MPRemoteCommandCenter). */
  setEnabled(enabled: boolean): void;
}

export interface RemoteTrackRouter {
  /** Whether the native module is really there (false = every call inert). */
  readonly available: boolean;
  /**
   * Mirrors lock-screen activation, so the buttons exist exactly while a song
   * is published. Idempotent: repeated identical calls never reach native.
   */
  setActive(active: boolean): void;
  /** Drops the listeners and hides the buttons (logout / teardown). */
  stop(): void;
}

export const inertRemoteTrackRouter: RemoteTrackRouter = {
  available: false,
  setActive: () => {},
  stop: () => {},
};

/**
 * Subscribes to the native next/previous events and routes them through the
 * injected callback. `route` is player/lockScreen's routeRemoteCommand in the
 * app and a spy in the tests; the router never touches the engine directly, so
 * a controller device keeps driving the ACTIVE device (FR-63 remote half).
 */
export const createRemoteTrackRouter = (
  commands: RemoteTrackCommands | null,
  route: (kind: "next" | "previous") => void,
): RemoteTrackRouter => {
  if (!commands) return inertRemoteTrackRouter;
  const native = commands;

  let subscriptions: RemoteTrackSubscription[] = [
    native.addListener("nextTrack", () => route("next")),
    native.addListener("previousTrack", () => route("previous")),
  ];
  let active: boolean | null = null;
  let stopped = false;

  return {
    available: true,
    setActive(next: boolean): void {
      if (stopped || active === next) return;
      active = next;
      native.setEnabled(next);
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      // A router that was never activated has nothing to turn off natively.
      if (active !== null) native.setEnabled(false);
      active = false;
      for (const subscription of subscriptions) subscription.remove();
      subscriptions = [];
    },
  };
};
