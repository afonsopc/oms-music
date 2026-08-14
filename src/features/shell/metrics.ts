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
import { useDesktopShell } from "@/ui/shellLayout";

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

/**
 * Bottom padding of the main pane's scrollables inside the DESKTOP shell:
 * the transport bar is a grid ROW below the pane, not an overlay, so there
 * is no pill to clear - just breathing room for the last list item.
 */
const DESKTOP_CONTENT_BOTTOM = 24;

/** Distance from the screen bottom to the overlay's bottom edge. */
export const useOverlayBottomOffset = (): number => {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const measured = useMeasuredTabBarHeight();
  const desktop = useDesktopShell();
  // Desktop shell: the tab bar does not render, so its measured height (or
  // the phone fallback) must not push the remaining overlays (offline
  // banner, jam bar) anywhere - they float just above the pane's bottom
  // edge. Without this gate the last MOBILE measurement leaks into desktop.
  if (desktop) return OVERLAY_MARGIN;
  const tabsFocused = (segments as string[]).includes("(tabs)");
  if (tabsFocused) {
    return (measured > 0 ? measured : TAB_BAR_FALLBACK + insets.bottom) + OVERLAY_MARGIN;
  }
  return insets.bottom + OVERLAY_MARGIN;
};

/**
 * Bottom padding every scrollable screen applies (FR-16 AC: the pill never
 * covers list tails). Constant whether or not a song is loaded, so lists do
 * not jump when playback starts. In the desktop shell there is no floating
 * pill (the transport bar is a grid row), so no tab-bar-height math applies.
 */
export const useContentBottomPadding = (): number => {
  const offset = useOverlayBottomOffset();
  const desktop = useDesktopShell();
  return desktop ? DESKTOP_CONTENT_BOTTOM : offset + OVERLAY_PILL_HEIGHT + OVERLAY_MARGIN;
};

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
