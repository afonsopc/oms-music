import { describe, expect, it } from "bun:test";
import { matchScore, rankByMatch } from "../rank";

describe("matchScore", () => {
  it("scores exact > prefix > word-start > substring > none", () => {
    expect(matchScore("carlos", "carlos")).toBe(100);
    expect(matchScore("carlos paiao", "carlos")).toBe(80);
    expect(matchScore("agrupamento carlos", "carlos")).toBe(60);
    expect(matchScore("descarlosado", "carlos")).toBe(40);
    expect(matchScore("nothing", "carlos")).toBe(0);
  });

  it("is accent- and case-insensitive", () => {
    expect(matchScore("Carlos Paião", "paiao")).toBe(60);
    expect(matchScore("PAIÃO", "paião")).toBe(100);
  });
});

describe("rankByMatch", () => {
  it('surfaces "Carlos Paião" above alphabetically-earlier weak matches', () => {
    const items = [
      "Agrupamento Escolas D. Carlos I",
      "Banda Qualquer",
      "Carlos Paião",
    ];
    const ranked = rankByMatch(items, "carlos", (s) => s);
    expect(ranked[0]).toBe("Carlos Paião");
  });

  it("prefers the shorter name on equal score", () => {
    const ranked = rankByMatch(["Carlos Paião", "Carlos"], "carlos", (s) => s);
    expect(ranked[0]).toBe("Carlos");
  });

  it("returns the input untouched for a blank query", () => {
    const items = ["b", "a"];
    expect(rankByMatch(items, "  ", (s) => s)).toEqual(["b", "a"]);
  });
});
