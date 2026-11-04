import { describe, expect, test } from "bun:test";
import { parseLrc } from "../lrc";
import { wordsForLines, wordsSung } from "../words";

describe("wordsForLines", () => {
  const lines = parseLrc("[00:10.00] Hello world\n[00:12.00]\n[00:14.50] Again");

  test("matches each line by its timestamp, with slack for rounding", () => {
    const words = wordsForLines(lines, [
      { t: 10.01, w: [[10.0, 10.4, "Hello"], [10.5, 10.9, "world"]] },
      { t: 14.5, w: [[14.5, 15.0, "Again"]] },
    ]);
    expect(words[0]?.map((w) => w[2])).toEqual(["Hello", "world"]);
    expect(words[1]).toBeNull();
    expect(words[2]?.[0][2]).toBe("Again");
  });

  test("no words from the server means no words anywhere", () => {
    expect(wordsForLines(lines, undefined)).toEqual([null, null, null]);
  });
});

describe("wordsSung", () => {
  test("counts the words already started", () => {
    const w: [number, number, string][] = [[1, 1.3, "a"], [1.4, 1.8, "b"]];
    expect(wordsSung(w, 0.5)).toBe(0);
    expect(wordsSung(w, 1.5)).toBe(2);
  });
});
