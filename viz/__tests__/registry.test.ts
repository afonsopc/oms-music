import { describe, expect, it } from "bun:test";
import { metaErrors } from "../lib/scene";
import { scan } from "../tools/registry";
import { SCENES } from "../scenes/_registry";

describe("o índice das cenas", () => {
  it("todas as cenas têm meta válido, id = nome do ficheiro, ids únicos", async () => {
    const { found, errors } = await scan();
    expect(errors).toEqual([]);
    expect(found.length).toBe(SCENES.length);
    expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
  });

  it("o índice gerado está em dia com os ficheiros", async () => {
    const { found } = await scan();
    expect(SCENES.map((s) => `${s.pack}/${s.meta.id}`).sort()).toEqual(found.map((f) => `${f.pack}/${f.id}`).sort());
    for (const s of SCENES) expect(metaErrors(s.meta, s.meta.id)).toEqual([]);
  });

  it("cada cena carrega e cria-se sem browser (nada de DOM ao importar nem no create)", async () => {
    for (const s of SCENES) {
      const m = (await s.load()).default;
      expect(m.meta.id).toBe(s.meta.id);
      expect(typeof m.create().frame).toBe("function");
    }
  });

  it("há só uma cena de fundo, a aurora", () => {
    expect(SCENES.filter((s) => s.meta.background).map((s) => s.meta.id)).toEqual(["aurora"]);
  });
});
