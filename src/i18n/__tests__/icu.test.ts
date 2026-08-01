import { describe, expect, it } from "bun:test";
import { formatIcu, pluralCategory } from "../icu";

describe("formatIcu", () => {
  it("substitutes simple params", () => {
    expect(formatIcu("Playing on {device}", "en", { device: "iPhone" })).toBe(
      "Playing on iPhone",
    );
  });

  it("leaves unknown params visible", () => {
    expect(formatIcu("Hi {name}", "en", {})).toBe("Hi {name}");
  });

  it("handles plural with # substitution", () => {
    const msg = "{count, plural, one {# artist} other {# artists}}";
    expect(formatIcu(msg, "en", { count: 1 })).toBe("1 artist");
    expect(formatIcu(msg, "en", { count: 3 })).toBe("3 artists");
  });

  it("prefers exact =N branches", () => {
    const msg = "{count, plural, =1 {1 song selected} other {{count} songs selected}}";
    expect(formatIcu(msg, "en", { count: 1 })).toBe("1 song selected");
    expect(formatIcu(msg, "en", { count: 4 })).toBe("4 songs selected");
  });

  it("supports the Latvian zero category", () => {
    const msg = "{count, plural, zero {# dziesmu} one {# dziesma} other {# dziesmas}}";
    expect(formatIcu(msg, "lv", { count: 10 })).toBe("10 dziesmu");
    expect(formatIcu(msg, "lv", { count: 21 })).toBe("21 dziesma");
    expect(formatIcu(msg, "lv", { count: 2 })).toBe("2 dziesmas");
  });

  it("formats {value, number}", () => {
    expect(formatIcu("{minutes, number} min", "en", { minutes: 5 })).toBe("5 min");
  });

  it("treats plain apostrophes as literals", () => {
    expect(formatIcu("you haven't played it yet", "en")).toBe("you haven't played it yet");
  });
});

describe("pluralCategory", () => {
  it("en/pt: one only for exactly 1", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("pt", 1)).toBe("one");
    expect(pluralCategory("pt", 0)).toBe("other");
    expect(pluralCategory("en", 2)).toBe("other");
  });

  it("lv: zero for 0/10..19 multiples, one for 1 mod 10 (not 11)", () => {
    expect(pluralCategory("lv", 0)).toBe("zero");
    expect(pluralCategory("lv", 10)).toBe("zero");
    expect(pluralCategory("lv", 11)).toBe("zero");
    expect(pluralCategory("lv", 1)).toBe("one");
    expect(pluralCategory("lv", 21)).toBe("one");
    expect(pluralCategory("lv", 2)).toBe("other");
  });
});
