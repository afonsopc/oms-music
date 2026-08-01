import { describe, expect, it } from "bun:test";
import { deepNullToSentinel, encodeQuery, NULL_SENTINEL, pageModifier } from "../params";

describe("deepNullToSentinel", () => {
  it("rewrites nulls at every depth", () => {
    expect(
      deepNullToSentinel({ album: null, nested: { a: null, b: [null, 1] } }),
    ).toEqual({
      album: NULL_SENTINEL,
      nested: { a: NULL_SENTINEL, b: [NULL_SENTINEL, 1] },
    });
  });

  it("drops undefined keys (omitting a key means no filter)", () => {
    expect(deepNullToSentinel({ a: undefined, b: 1 })).toEqual({ b: 1 });
  });

  it("leaves scalars and strings alone", () => {
    expect(deepNullToSentinel("x")).toBe("x");
    expect(deepNullToSentinel(0)).toBe(0);
    expect(deepNullToSentinel(false)).toBe(false);
  });

  it("uses the literal one-char backspace", () => {
    expect(NULL_SENTINEL).toBe("\b");
    expect(NULL_SENTINEL).toHaveLength(1);
  });
});

describe("encodeQuery (bracket DSL)", () => {
  it("encodes nested filter objects axios-style", () => {
    const query = encodeQuery({
      search: { title: "x y" },
      exact_search: { artist: "Carlos Paião" },
      modifiers: { page: "1:20", order: "name:asc" },
    });
    expect(query).toContain("search[title]=x%20y");
    expect(query).toContain("exact_search[artist]=Carlos%20Pai%C3%A3o");
    expect(query).toContain("modifiers[page]=1%3A20");
    expect(query).toContain("modifiers[order]=name%3Aasc");
  });

  it("encodes arrays as key[]=a&key[]=b", () => {
    expect(encodeQuery({ ids: [1, 2] })).toBe("ids[]=1&ids[]=2");
  });

  it("encodes booleans as strings", () => {
    expect(encodeQuery({ modifiers: { random: true } })).toBe("modifiers[random]=true");
  });

  it("encodes null values as the sentinel", () => {
    expect(encodeQuery({ exact_search: { album: null } })).toBe(
      `exact_search[album]=${encodeURIComponent("\b")}`,
    );
  });

  it("skips undefined values", () => {
    expect(encodeQuery({ a: undefined, b: 1 })).toBe("b=1");
  });
});

describe("pageModifier", () => {
  it("formats 1-based N:SIZE", () => {
    expect(pageModifier(2, 100)).toBe("2:100");
  });

  it("caps SIZE at the 500 hard cap", () => {
    expect(pageModifier(1, 9999)).toBe("1:500");
  });

  it("floors page to at least 1", () => {
    expect(pageModifier(0, 20)).toBe("1:20");
  });
});
