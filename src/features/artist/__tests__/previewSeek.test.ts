/** O salto do preview: 1/3 da faixa com tecto, e faixas curtas do início. */
import { describe, expect, test } from "bun:test";
import { previewSeekSeconds } from "../previewMath";

describe("previewSeekSeconds", () => {
  test("um terço da faixa, com tecto de 45s", () => {
    expect(previewSeekSeconds(180)).toBe(60 > 45 ? 45 : 60);
    expect(previewSeekSeconds(90)).toBe(30);
    expect(previewSeekSeconds(600)).toBe(45);
  });

  test("faixas curtas ou sem duração começam do zero", () => {
    expect(previewSeekSeconds(25)).toBe(0);
    expect(previewSeekSeconds(null)).toBe(0);
    expect(previewSeekSeconds(undefined)).toBe(0);
  });
});
