import { describe, expect, it } from "bun:test";
import { transportGeometry } from "../transportLayout";

describe("transportGeometry", () => {
  it("janela estreita: centro no mínimo e o lado direito agrupa", () => {
    const g = transportGeometry(1000);
    expect(g.center).toBe(400);
    expect(g.tier).toBe("tight");
  });

  it("janela média (a do dono, ~1300-1500 px) fica compacta", () => {
    expect(transportGeometry(1300).tier).toBe("compact");
    expect(transportGeometry(1500).tier).toBe("compact");
  });

  it("janela larga mostra tudo e o centro não passa do tecto", () => {
    const g = transportGeometry(1700);
    expect(g.tier).toBe("full");
    expect(transportGeometry(3000).center).toBe(620);
  });

  it("as três colunas cabem sempre na barra", () => {
    for (let w = 900; w <= 2600; w += 37) {
      const g = transportGeometry(w);
      expect(g.center + 2 * g.side + 2 * 24 + 2 * 24).toBeLessThanOrEqual(w);
    }
  });
});
