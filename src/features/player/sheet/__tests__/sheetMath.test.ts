import { describe, expect, it } from "bun:test";
import { clampProgress, SHEET_FLING_VELOCITY, sheetSnapTarget } from "../sheetMath";

describe("folha do leitor: decidir ao largar", () => {
  it("um gesto rápido manda, mesmo curto", () => {
    expect(sheetSnapTarget(0.9, SHEET_FLING_VELOCITY + 1)).toBe(0);
    expect(sheetSnapTarget(0.1, -SHEET_FLING_VELOCITY - 1)).toBe(1);
  });
  it("devagar, decide a posição", () => {
    expect(sheetSnapTarget(0.6, 100)).toBe(1);
    expect(sheetSnapTarget(0.4, -100)).toBe(0);
  });
  it("o progresso fica entre 0 e 1", () => {
    expect(clampProgress(-0.2)).toBe(0);
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(0.3)).toBe(0.3);
  });
});
