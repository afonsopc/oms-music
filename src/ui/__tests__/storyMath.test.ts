/** A aritmética do visor de stories: limites, barras e relógio. */
import { describe, expect, test } from "bun:test";
import { nextStoryIndex, prevStoryIndex, segmentFill, tickProgress } from "../storyMath";

describe("storyMath", () => {
  test("avançar no último cartão devolve null (fechar)", () => {
    expect(nextStoryIndex(0, 3)).toBe(1);
    expect(nextStoryIndex(2, 3)).toBeNull();
    expect(nextStoryIndex(0, 1)).toBeNull();
  });

  test("recuar no primeiro fica no primeiro", () => {
    expect(prevStoryIndex(0)).toBe(0);
    expect(prevStoryIndex(2)).toBe(1);
  });

  test("as barras enchem atrás, parcial na actual, vazias à frente", () => {
    expect(segmentFill(0, 1, 0.4)).toBe(1);
    expect(segmentFill(1, 1, 0.4)).toBeCloseTo(0.4);
    expect(segmentFill(2, 1, 0.4)).toBe(0);
    expect(segmentFill(1, 1, 7)).toBe(1); // clamp
    expect(segmentFill(1, 1, -1)).toBe(0);
  });

  test("o relógio avança em fracções da duração e nunca divide por zero", () => {
    expect(tickProgress(0, 50, 5_000)).toBeCloseTo(0.01);
    expect(tickProgress(0.99, 100, 5_000)).toBeGreaterThan(1);
    expect(tickProgress(0.5, 50, 0)).toBe(1);
  });
});
