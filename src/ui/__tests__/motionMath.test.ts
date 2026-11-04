import { describe, expect, test } from "bun:test";
import { staggerDelay, waitPhraseKey } from "../motionMath";

describe("staggerDelay", () => {
  test("cresce por passo", () => expect(staggerDelay(3)).toBe(120));
  test("nunca passa do tecto", () => expect(staggerDelay(100)).toBe(400));
  test("ordem negativa é zero", () => expect(staggerDelay(-2)).toBe(0));
});

describe("waitPhraseKey", () => {
  test("calada no princípio", () => expect(waitPhraseKey(1500)).toBeNull());
  test("aos 2 s", () => expect(waitPhraseKey(2000)).toBe("waitSlow"));
  test("aos 6 s", () => expect(waitPhraseKey(7000)).toBe("waitSlower"));
  test("aos 20 s oferece tentar de novo", () => expect(waitPhraseKey(20000)).toBe("waitStuck"));
});
