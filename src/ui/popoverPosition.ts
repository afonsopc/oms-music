/**
 * Pure popover placement (plano-uma-so-app 4.3, "Menus" row). Free of
 * react imports so the clamping rules are bun-testable: the anchored menu
 * must open AT the pointer but never bleed off any window edge - a
 * right-click near the bottom-right corner slides the card up and left
 * until it fits, which is exactly what every native context menu does.
 */
export interface PopoverAnchor {
  x: number;
  y: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverWindow {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
}

export const POPOVER_MARGIN = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/**
 * Top-left corner for a popover of `size` anchored at `anchor`. The anchor
 * wins while there is room; the margin wins when there is not (a window
 * smaller than the popover pins it to the top-left margin rather than
 * producing negative coordinates).
 */
export const popoverPlacement = (
  anchor: PopoverAnchor,
  size: PopoverSize,
  window: PopoverWindow,
  margin: number = POPOVER_MARGIN,
): PopoverPlacement => ({
  left: clamp(anchor.x, margin, Math.max(margin, window.width - size.width - margin)),
  top: clamp(anchor.y, margin, Math.max(margin, window.height - size.height - margin)),
});
