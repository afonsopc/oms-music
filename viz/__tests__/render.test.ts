/**
 * Cada cena no browser (Chrome sem janela, GPU a sério): entra, desenha 120
 * frames sem erros, desfaz-se sem deixar nada, e cabe no orçamento por frame
 * do seu custo (BUDGET_MS em viz/tools/shots.ts). Lento (~1 s por cena),
 * por isso só corre com VIZ_RENDER=1:
 *
 *   bun run viz:test                       # todas
 *   VIZ_ONLY=plasma,milk bun run viz:test  # só estas
 *   VIZ_PACK=retro bun run viz:test        # só um pacote
 */
import { describe, expect, it } from "bun:test";
import { runScenes, type SceneReport } from "../tools/shots";

const on = !!process.env.VIZ_RENDER;

describe.skipIf(!on)("as cenas no browser", () => {
  let reports: SceneReport[] = [];
  it("correm todas", async () => {
    ({ reports } = await runScenes({ video: false, only: process.env.VIZ_ONLY?.split(","), pack: process.env.VIZ_PACK, log: () => {} }));
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      const why = [...r.errors, ...r.leftovers].join("; ");
      expect({ id: r.id, ok: r.ok, why }).toEqual({ id: r.id, ok: true, why: "" });
      expect({ id: r.id, avgMs: r.avgMs, within: r.avgMs <= r.budgetMs }).toEqual({ id: r.id, avgMs: r.avgMs, within: true });
    }
  }, 600_000);
});
