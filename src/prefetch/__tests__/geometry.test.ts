/**
 * Offset -> row indices. Exact by construction (fixed row height), so every
 * case here is arithmetic with a known answer rather than a tolerance.
 */
import { describe, expect, it } from "bun:test";
import { viewportIndices, type ListGeometry } from "../geometry";

const geometry = (patch: Partial<ListGeometry>): ListGeometry => ({
  offsetY: 0,
  headerHeight: 400,
  rowHeight: 56,
  viewportHeight: 700,
  rowCount: 200,
  ...patch,
});

describe("viewportIndices", () => {
  it("targets row 0 while the hero is still on screen", () => {
    // body is NEGATIVE here (-400), so first and centre both clamp to 0 -
    // that clamp is what makes "just opened a playlist" resolve to its first
    // song with no special case anywhere. `last` is real: 300px of rows peek
    // out below the 400px header, which is 5 rows at 56px.
    expect(viewportIndices(geometry({ offsetY: 0 }))).toEqual({
      first: 0,
      centerIndex: 0,
      last: 5,
    });
  });

  it("resolves a scrolled body offset exactly", () => {
    // body = 10 rows; centre = 10 + 350/56 = 16.25; last = 10 + 700/56 = 22.5
    const g = geometry({ offsetY: 400 + 10 * 56 });
    expect(viewportIndices(g)).toEqual({ first: 10, centerIndex: 16, last: 22 });
  });

  it("shifts indices for compact rows", () => {
    // body = 10 * 40 = 400px -> first = 10; centre = (400 + 350) / 40 = 18;
    // last = (400 + 700) / 40 = 27.
    const g = geometry({ offsetY: 400 + 10 * 40, rowHeight: 40 });
    expect(viewportIndices(g)).toEqual({ first: 10, centerIndex: 18, last: 27 });
  });

  it("reports nothing when the list is empty or the row height is unknown", () => {
    const unknown = { first: null, centerIndex: null, last: null };
    expect(viewportIndices(geometry({ rowCount: 0 }))).toEqual(unknown);
    expect(viewportIndices(geometry({ rowHeight: 0 }))).toEqual(unknown);
  });

  it("clamps past the end instead of running off the array", () => {
    const g = geometry({ offsetY: 1_000_000, rowCount: 12 });
    expect(viewportIndices(g)).toEqual({ first: 11, centerIndex: 11, last: 11 });
  });

  it("never returns a negative index", () => {
    const g = geometry({ offsetY: 0, headerHeight: 5_000 });
    const v = viewportIndices(g);
    expect(v.first).toBe(0);
    expect(v.centerIndex).toBe(0);
    expect(v.last).toBe(0);
  });
});
