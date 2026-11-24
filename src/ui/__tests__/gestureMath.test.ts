import { describe, expect, test } from "bun:test";
import { rowDragOffset } from "../rowDragMath";
import { shouldDismissSheet } from "../sheets/sheetDismiss";
import { SWIPE_ACTION_WIDTH, swipeSettles } from "../swipeMath";

describe("rowDragOffset", () => {
  test("the dragged row follows the finger", () => expect(rowDragOffset(3, 3, 41, 56)).toBe(41));
  test("nobody moves at rest", () => {
    for (const i of [0, 1, 2, 4, 5]) expect(Math.abs(rowDragOffset(i, 3, 0, 56))).toBe(0);
  });
  test("neighbours make room exactly past half a row", () => {
    expect(rowDragOffset(4, 3, 56, 56)).toBe(-56);
    expect(Math.abs(rowDragOffset(5, 3, 56, 56))).toBe(0);
    expect(rowDragOffset(2, 3, -56, 56)).toBe(56);
    expect(rowDragOffset(4, 3, 28, 56)).toBe(-28);
  });
});

describe("sheet pull", () => {
  test("a flick or a third closes, a nudge or a flick up does not", () => {
    expect(shouldDismissSheet(20, 900, 600)).toBe(true);
    expect(shouldDismissSheet(170, 0, 600)).toBe(true);
    expect(shouldDismissSheet(40, 0, 600)).toBe(false);
    expect(shouldDismissSheet(300, -900, 600)).toBe(false);
    expect(shouldDismissSheet(0, 2000, 600)).toBe(false);
  });
});

test("swipe settles past half the action or with a flick", () => {
  expect(swipeSettles(-SWIPE_ACTION_WIDTH * 0.6, 0)).toBe(true);
  expect(swipeSettles(-20, 0)).toBe(false);
  expect(swipeSettles(-20, -900)).toBe(true);
  expect(swipeSettles(-90, 900)).toBe(false);
});
