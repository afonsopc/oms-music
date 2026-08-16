/** As contas do cartão "o tempo que deste": minutos totais e fidelidade. */
import { describe, expect, test } from "bun:test";
import { loyaltyPercent, totalListenMinutes, totalListenSeconds } from "../rewindMath";

describe("totalListenSeconds", () => {
  test("soma contagem x duração sobre as faixas", () => {
    expect(
      totalListenSeconds([
        { play_count: 10, duration: 200 },
        { play_count: 3, duration: 100 },
      ]),
    ).toBe(2300);
  });

  test("faixas sem duração (null, undefined, 0) contam zero", () => {
    expect(
      totalListenSeconds([
        { play_count: 50, duration: null },
        { play_count: 50, duration: undefined },
        { play_count: 50, duration: 0 },
        { play_count: 2, duration: 60 },
      ]),
    ).toBe(120);
    expect(totalListenSeconds([])).toBe(0);
  });
});

describe("totalListenMinutes", () => {
  test("arredonda para minutos inteiros", () => {
    expect(totalListenMinutes([{ play_count: 1, duration: 90 }])).toBe(2);
    expect(totalListenMinutes([{ play_count: 1, duration: 29 }])).toBe(0);
  });
});

describe("loyaltyPercent", () => {
  test("fatia da primeira entrada, inteira", () => {
    expect(loyaltyPercent([50, 30, 20])).toBe(50);
    expect(loyaltyPercent([1, 2])).toBe(33);
  });

  test("sem reproduções devolve 0", () => {
    expect(loyaltyPercent([])).toBe(0);
    expect(loyaltyPercent([0, 0])).toBe(0);
  });
});
