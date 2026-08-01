import { describe, expect, it } from "bun:test";
import { toSongId, toSongKey } from "../ids";

describe("id converters (the ONLY legal conversion point)", () => {
  it("round-trips number -> key -> id", () => {
    const key = toSongKey(42);
    expect(key).toBe("42");
    expect(toSongId(key)).toBe(42);
  });

  it("round-trips string -> id -> key", () => {
    const id = toSongId("1234567");
    expect(id).toBe(1234567);
    expect(toSongKey(id)).toBe("1234567");
  });
});
