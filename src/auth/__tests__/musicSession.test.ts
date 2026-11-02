import { describe, expect, test } from "bun:test";
import { isMusicToken } from "../musicSession";

describe("isMusicToken", () => {
  test("só os tokens das sessões da música", () => {
    expect(isMusicToken("omsm_abc")).toBe(true);
    expect(isMusicToken("8f1c2d3e-uuid-do-omelhorsite")).toBe(false);
    expect(isMusicToken(null)).toBe(false);
  });
});
