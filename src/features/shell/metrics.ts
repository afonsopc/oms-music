/**
 * Overlay geometry (FR-16). The overlay host floats the MiniPlayer pill above
 * the tab bar (tab screens) or above the bottom safe area (pushed screens);
 * every scrollable screen pads its bottom with useContentBottomPadding() so
 * list tails are never covered - the bottom-padding convention feature
 * packages code against.
 */
import { useSyncExternalStore } from "react";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Pill height (web mobile mini player: 64px, rounded-xl). */
export const OVERLAY_PILL_HEIGHT = 64;
/** Gap between the pill and whatever it floats above (web: inset 8). */
export const OVERLAY_MARGIN = 8;
/** Fallback tab bar core height until the real bar reports its layout. */
const TAB_BAR_FALLBACK = 49;

let measuredTabBarHeight = 0;
const listeners = new Set<() => void>();

/** Reported by the shell tab bar wrapper's onLayout. */
export const setMeasuredTabBarHeight = (height: number): void => {
  if (height === measuredTabBarHeight) return;
  measuredTabBarHeight = height;
  for (const cb of listeners) cb();
};

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getHeight = (): number => measuredTabBarHeight;

export const useMeasuredTabBarHeight = (): number =>
  useSyncExternalStore(subscribe, getHeight, getHeight);

/** Distance from the screen bottom to the overlay's bottom edge. */
export const useOverlayBottomOffset = (): number => {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const measured = useMeasuredTabBarHeight();
  const tabsFocused = (segments as string[]).includes("(tabs)");
  if (tabsFocused) {
    return (measured > 0 ? measured : TAB_BAR_FALLBACK + insets.bottom) + OVERLAY_MARGIN;
  }
  return insets.bottom + OVERLAY_MARGIN;
};

/**
 * Bottom padding every scrollable screen applies (FR-16 AC: the pill never
 * covers list tails). Constant whether or not a song is loaded, so lists do
 * not jump when playback starts.
 */
export const useContentBottomPadding = (): number =>
  useOverlayBottomOffset() + OVERLAY_PILL_HEIGHT + OVERLAY_MARGIN;

/**
 * Top padding for a scrollable screen that draws its OWN heading rather than
 * a Hero. The Hero applies the inset itself, so collection screens must not
 * use this or they would pay it twice; downloads and settings do, which is
 * why their titles sat under the dynamic island.
 */
export const useContentTopPadding = (extra = 16): number => {
  const insets = useSafeAreaInsets();
  return insets.top + extra;
};
