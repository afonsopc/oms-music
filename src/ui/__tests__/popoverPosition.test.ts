/**
 * Locks the context-menu placement rules (plano-uma-so-app 4.3, Menus row):
 * open AT the pointer when there is room, slide inside the margin when
 * there is not, and never emit negative coordinates even in a window
 * smaller than the popover itself.
 */
import { describe, expect, test } from "bun:test";
import { popoverPlacement, POPOVER_MARGIN } from "../popoverPosition";

const WINDOW = { width: 1440, height: 900 };
const SIZE = { width: 300, height: 400 };

describe("popoverPlacement", () => {
  test("anchor wins while the card fits", () => {
    expect(popoverPlacement({ x: 200, y: 150 }, SIZE, WINDOW)).toEqual({
      left: 200,
      top: 150,
    });
  });

  test("right/bottom edges push the card back inside the margin", () => {
    const placed = popoverPlacement({ x: 1400, y: 880 }, SIZE, WINDOW);
    expect(placed.left).toBe(WINDOW.width - SIZE.width - POPOVER_MARGIN);
    expect(placed.top).toBe(WINDOW.height - SIZE.height - POPOVER_MARGIN);
  });

  test("anchors left of / above the margin clamp to the margin", () => {
    expect(popoverPlacement({ x: 0, y: -20 }, SIZE, WINDOW)).toEqual({
      left: POPOVER_MARGIN,
      top: POPOVER_MARGIN,
    });
  });

  test("a window smaller than the card pins to the margin, never negative", () => {
    const placed = popoverPlacement({ x: 100, y: 100 }, SIZE, { width: 200, height: 200 });
    expect(placed).toEqual({ left: POPOVER_MARGIN, top: POPOVER_MARGIN });
  });
});
