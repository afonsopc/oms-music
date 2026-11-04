import { describe, expect, test } from "bun:test";
import { mayPlaySoundtrack } from "../soundtrackPolicy";

describe("mayPlaySoundtrack", () => {
  test("a comandar outro aparelho fica calado", () => expect(mayPlaySoundtrack("controller")).toBe(false));
  test("este aparelho a tocar, ou ninguém, toca", () => {
    expect(mayPlaySoundtrack("active")).toBe(true);
    expect(mayPlaySoundtrack("no_active")).toBe(true);
    expect(mayPlaySoundtrack("offline")).toBe(true);
  });
});
