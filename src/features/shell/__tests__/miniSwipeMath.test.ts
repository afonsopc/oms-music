import { describe, expect, test } from "bun:test";
import { miniSwipeDecision } from "../miniSwipeMath";

describe("miniSwipeDecision", () => {
  test("left is next, right is previous", () => {
    expect(miniSwipeDecision(-90, 4, -100, 0)).toBe("next");
    expect(miniSwipeDecision(90, -4, 100, 0)).toBe("previous");
  });
  test("a quick flick counts even when short", () => {
    expect(miniSwipeDecision(-30, 2, -900, 0)).toBe("next");
  });
  test("up opens the player", () => {
    expect(miniSwipeDecision(4, -50, 0, -100)).toBe("open");
    expect(miniSwipeDecision(2, -20, 0, -1000)).toBe("open");
  });
  test("short or downward drags do nothing", () => {
    expect(miniSwipeDecision(-20, 3, -100, 0)).toBeNull();
    expect(miniSwipeDecision(0, 60, 0, 800)).toBeNull();
    expect(miniSwipeDecision(5, -10, 0, -100)).toBeNull();
  });
});
