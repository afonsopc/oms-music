/**
 * Shell slot registry (WP2). The shell owns the overlay host, the MiniPlayer
 * pill and the root provider stack, but several of the things they render are
 * built by later packages (WP3 player store, WP8 DownloadStatusProvider, WP9
 * controller strip + cast button, WP10 JamBar). Each of those registers here
 * from its own register.ts (imported by boot/wireup.ts) so every package
 * compiles and runs standalone, mirroring the src/contracts seam pattern.
 *
 * Expected registrations (wired by WP12's boot/wireup.ts):
 * - WP8: registerShellProvider(DownloadStatusProvider from downloads/context).
 * - WP9: registerControllerStripOverlay + registerCastButton (DevicePicker).
 * - WP10: registerJamBarOverlay (JamBar body; replaces the pill while
 *   following a jam).
 *
 * The MiniPlayer's data does NOT go through a slot: it reads the player
 * store directly (usePillPlayerState.ts), per WORKPLAN WP2.5.
 */
import {
  createElement,
  Fragment,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Registry + version counter
// ---------------------------------------------------------------------------

/**
 * An overlay surface that decides its own visibility. `isActive`/`subscribe`
 * adapt trivially from a zustand store (`getState` projection + `subscribe`).
 */
export interface OverlaySlot {
  /** Synchronous read: should this overlay render right now? */
  isActive(): boolean;
  subscribe(cb: () => void): () => void;
  Component: ComponentType;
}

export type ShellProvider = ComponentType<{ children?: ReactNode }>;

interface ShellSlotRegistry {
  providers: ShellProvider[];
  jamBar: OverlaySlot | null;
  controllerStrip: OverlaySlot | null;
  castButton: ComponentType | null;
}

const registry: ShellSlotRegistry = {
  providers: [],
  jamBar: null,
  controllerStrip: null,
  castButton: null,
};

let version = 0;
const listeners = new Set<() => void>();

const bump = (): void => {
  version += 1;
  for (const cb of listeners) cb();
};

const subscribeRegistry = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getVersion = (): number => version;

/** Re-renders consumers when a slot registers (normally once, at boot). */
export const useShellSlotsVersion = (): number =>
  useSyncExternalStore(subscribeRegistry, getVersion, getVersion);

export const getShellSlots = (): Readonly<ShellSlotRegistry> => registry;

// ---------------------------------------------------------------------------
// Registration API (called from subsystem register.ts files via wireup)
// ---------------------------------------------------------------------------

/** Adds a provider to the root stack (e.g. WP8's DownloadStatusProvider). */
export const registerShellProvider = (provider: ShellProvider): void => {
  registry.providers.push(provider);
  bump();
};

/** WP10: the JamBar replaces the MiniPlayer pill while following a jam. */
export const registerJamBarOverlay = (slot: OverlaySlot): void => {
  registry.jamBar = slot;
  bump();
};

/** WP9: the emerald "Playing on X" strip attached above the pill. */
export const registerControllerStripOverlay = (slot: OverlaySlot): void => {
  registry.controllerStrip = slot;
  bump();
};

/** WP9: the cast button rendered inside the MiniPlayer pill (FR-16). */
export const registerCastButton = (component: ComponentType): void => {
  registry.castButton = component;
  bump();
};

// ---------------------------------------------------------------------------
// Consumption hooks
// ---------------------------------------------------------------------------

export const useOverlaySlotActive = (slot: OverlaySlot): boolean =>
  useSyncExternalStore(slot.subscribe, slot.isActive, slot.isActive);

/**
 * Root provider slot (DESIGN 2: ... > SessionGate > DownloadStatusProvider >
 * gesture root). Registered providers wrap the children in registration
 * order (first registered = outermost).
 */
export const SlotProviders = ({ children }: { children: ReactNode }) => {
  useShellSlotsVersion();
  let content: ReactNode = children;
  for (let i = registry.providers.length - 1; i >= 0; i -= 1) {
    content = createElement(registry.providers[i], null, content);
  }
  // Fragment keeps the return type a ReactElement without JSX in a .ts file.
  return createElement(Fragment, null, content);
};
