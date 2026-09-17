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

/**
 * Which corner of the card sits at the anchor. The default ("below" /
 * "start") is the context-menu case: the anchor is the card's top-left. A
 * card opened from a button on a bottom bar wants "above" (anchor is the
 * card's bottom edge) and, for a button at the right end of that bar,
 * "end" (anchor is the card's right edge) so it grows towards the centre.
 */
export interface PopoverSide {
  vertical?: "below" | "above";
  horizontal?: "start" | "end";
}

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
  side: PopoverSide = {},
): PopoverPlacement => {
  const x = side.horizontal === "end" ? anchor.x - size.width : anchor.x;
  const y = side.vertical === "above" ? anchor.y - size.height : anchor.y;
  return {
    left: clamp(x, margin, Math.max(margin, window.width - size.width - margin)),
    top: clamp(y, margin, Math.max(margin, window.height - size.height - margin)),
  };
};
