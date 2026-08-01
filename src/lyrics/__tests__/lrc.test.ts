import { describe, expect, it } from "bun:test";
import { activeLineIndex, parseLrc } from "../lrc";

describe("parseLrc (FR-76, exact web parity)", () => {
  it("parses [mm:ss.xx] with float seconds: time = minutes * 60 + seconds", () => {
    expect(parseLrc("[01:23.45]Hello")).toEqual([{ time: 83.45, text: "Hello" }]);
    expect(parseLrc("[00:07]No decimals")).toEqual([{ time: 7, text: "No decimals" }]);
    expect(parseLrc("[10:00.5]Big minutes")).toEqual([{ time: 600.5, text: "Big minutes" }]);
  });

  it("fans out multiple timestamps on one raw line into entries with the same text", () => {
    expect(parseLrc("[00:10.00][00:20.50]Chorus")).toEqual([
      { time: 10, text: "Chorus" },
      { time: 20.5, text: "Chorus" },
    ]);
  });

  it("skips metadata tags and untimed lines entirely", () => {
    const lrc = [
      "[ar:Bladee]",
      "[ti:Obedient]",
      "[offset:+120]",
      "just plain text",
      "",
      "[00:05.00]First real line",
    ].join("\n");
    expect(parseLrc(lrc)).toEqual([{ time: 5, text: "First real line" }]);
  });

  it('keeps empty timed lines with text "" (placeholder dot, still tappable)', () => {
    expect(parseLrc("[00:12.00]")).toEqual([{ time: 12, text: "" }]);
    expect(parseLrc("[00:12.00]   ")).toEqual([{ time: 12, text: "" }]);
  });

  it("sorts the result ascending by time (fan-out entries interleave)", () => {
    const lrc = ["[00:30.00]Third", "[00:05.00][00:40.00]Repeated", "[00:10.00]Second"].join("\n");
    expect(parseLrc(lrc)).toEqual([
      { time: 5, text: "Repeated" },
      { time: 10, text: "Second" },
      { time: 30, text: "Third" },
      { time: 40, text: "Repeated" },
    ]);
  });

  it("handles CRLF input and strips timestamps out of the text", () => {
    expect(parseLrc("[00:01.00]One\r\n[00:02.00]Two")).toEqual([
      { time: 1, text: "One" },
      { time: 2, text: "Two" },
    ]);
  });
});

describe("activeLineIndex (FR-77 active line = last line with time <= position)", () => {
  const lines = [
    { time: 5, text: "a" },
    { time: 10, text: "b" },
    { time: 20, text: "" },
  ];

  it("returns -1 only for an empty list", () => {
    expect(activeLineIndex([], 10)).toBe(-1);
  });

  it("clamps to the first line before its timestamp (max(0, i - 1))", () => {
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 4.99)).toBe(0);
  });

  it("activates exactly at the timestamp and holds until the next one", () => {
    expect(activeLineIndex(lines, 5)).toBe(0);
    expect(activeLineIndex(lines, 9.99)).toBe(0);
    expect(activeLineIndex(lines, 10)).toBe(1);
    expect(activeLineIndex(lines, 19.99)).toBe(1);
  });

  it("keeps the last line active past the end, including placeholder lines", () => {
    expect(activeLineIndex(lines, 20)).toBe(2);
    expect(activeLineIndex(lines, 9999)).toBe(2);
  });
});
