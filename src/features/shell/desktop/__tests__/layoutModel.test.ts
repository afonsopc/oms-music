/**
 * Pure layout-model tests (plan 4.5): persisted layout values come back
 * from localStorage as whatever an old build (or a curious owner with
 * devtools) left there, so every read path must clamp or fall back - the
 * shell renders its remembered shape on the FIRST frame, with no later
 * chance to correct a rogue value.
 */
import { describe, expect, it } from "bun:test";
import {
  clampSidebarWidth,
  COLLECTION_VIEW_MODE_CAP,
  DEFAULT_TIME_LABEL_MODE,
  isTimeLabelMode,
  recordViewMode,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../layoutModel";

describe("clampSidebarWidth", () => {
  it("passes sane widths through, rounded", () => {
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(300.6)).toBe(301);
  });

  it("clamps to the documented bounds", () => {
    expect(clampSidebarWidth(4)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(4000)).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("falls back to the default on garbage", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("the default itself is within bounds (or the fallback would clamp)", () => {
    expect(clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe("isTimeLabelMode", () => {
  it("accepts exactly the two modes", () => {
    expect(isTimeLabelMode("elapsed")).toBe(true);
    expect(isTimeLabelMode("remaining")).toBe(true);
    expect(isTimeLabelMode("countdown")).toBe(false);
    expect(isTimeLabelMode(null)).toBe(false);
    expect(isTimeLabelMode(DEFAULT_TIME_LABEL_MODE)).toBe(true);
  });
});

describe("recordViewMode", () => {
  it("records and updates without mutating the input", () => {
    const before = { a: "list" } as Record<string, string>;
    const after = recordViewMode(before, "b", "compact");
    expect(after).toEqual({ a: "list", b: "compact" });
    expect(before).toEqual({ a: "list" });
  });

  it("re-recording a key moves it to the back (recency order)", () => {
    const map = recordViewMode(
      recordViewMode(recordViewMode({}, "a", "list"), "b", "compact"),
      "a",
      "compact",
    );
    expect(Object.keys(map)).toEqual(["b", "a"]);
    expect(map["a"]).toBe("compact");
  });

  it("caps the map by dropping the OLDEST entries", () => {
    let map: Record<string, string> = {};
    for (let i = 0; i < 5; i++) map = recordViewMode(map, `k${i}`, "list", 3);
    expect(Object.keys(map)).toEqual(["k2", "k3", "k4"]);
  });

  it("the default cap is generous but finite", () => {
    expect(COLLECTION_VIEW_MODE_CAP).toBe(300);
  });
});
