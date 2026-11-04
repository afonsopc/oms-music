import { describe, expect, it } from "bun:test";
import type { SceneMeta } from "../lib/scene";
import { rng } from "../lib/random";
import { familyFor, memoryBagStore, ScenePicker, type PickContext } from "../selector";
import { SCENES } from "../scenes/_registry";

const song = (tags: string[], bpm: number | null = null) => ({ id: "1", title: "t", artist: "a", artworkUrl: null, tags, bpm });
const metas = SCENES.map((s) => s.meta);
const full = metas.filter((m) => !m.background);
const ctx = (o: Partial<PickContext> = {}): PickContext => ({ selection: "random", family: "retro", favorites: [], banned: [], tier: 3, ...o });

/** 100 cenas de mentira, para ver o baralho em grande. */
const fake = (n: number): SceneMeta[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, name: `S${i}`, families: [(["calm", "electronic", "chaos", "retro"] as const)[i % 4]], tags: i % 10 === 0 ? ["fado"] : [],
    intensity: ((i % 5) + 1) as 1, cost: ((i % 3) + 1) as 1, layer: "gl", signals: [], lyrics: "ink",
  }));

describe("escolha das cenas", () => {
  it("os géneros mandam", () => {
    expect(familyFor(song(["hardstyle"]), null)).toBe("chaos");
    expect(familyFor(song(["Hyperpop", "digicore"]), null)).toBe("chaos");
    expect(familyFor(song(["fado"]), null)).toBe("calm");
    expect(familyFor(song(["acoustic"]), null)).toBe("calm");
    expect(familyFor(song(["synthwave"]), null)).toBe("electronic");
  });

  it("sem géneros, o andamento e a energia", () => {
    const loud = { fps: 25, bpm: 160, beats: new Float64Array(), onsets: new Float64Array(), env: new Uint8Array(100).fill(220), bands: [], sections: [] };
    const soft = { ...loud, bpm: 80, env: new Uint8Array(100).fill(90) };
    expect(familyFor(song([]), loud)).toBe("chaos");
    expect(familyFor(song([]), soft)).toBe("calm");
  });

  it("as 23 de sempre continuam lá, e a aurora fica fora da rotação", () => {
    expect(full.length).toBeGreaterThanOrEqual(23);
    for (const id of ["milk", "text3d", "chrome", "tunnel", "kaleido", "pipes", "mystify", "starfield", "scope", "plasma", "desktop", "synthwave", "liquid", "voxel", "galaxy", "vhs", "datamosh", "ink", "film", "matrix", "vector", "pixel8", "collage"])
      expect(full.map((m) => m.id)).toContain(id);
    const p = new ScenePicker(metas);
    for (let i = 0; i < 100; i++) expect(p.next(ctx())).not.toBe("aurora");
  });

  it("nunca dá uma banida, nunca repete seguida", () => {
    const p = new ScenePicker(metas);
    let last = "";
    for (let i = 0; i < 300; i++) {
      const s = p.next(ctx({ favorites: ["ink"], banned: ["desktop", "vhs"] }));
      expect(s).not.toBe(last);
      expect(["desktop", "vhs"]).not.toContain(s);
      last = s;
    }
  });

  it("com 100 cenas, nenhuma volta antes de todas terem passado", () => {
    const p = new ScenePicker(fake(100));
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = p.next(ctx());
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
    expect(seen.size).toBe(100);
    // a volta seguinte não começa por uma das últimas
    const lastSix = [...seen].slice(-6);
    expect(lastSix).not.toContain(p.next(ctx()));
  });

  it("as favoritas saem mais ou menos o dobro das outras", () => {
    const p = new ScenePicker(fake(20), undefined, rng(7));
    const count = new Map<string, number>();
    for (let i = 0; i < 2200; i++) { const s = p.next(ctx({ favorites: ["s3", "s7"] })); count.set(s, (count.get(s) ?? 0) + 1); }
    const others = [...count].filter(([k]) => k !== "s3" && k !== "s7").map(([, v]) => v);
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    expect(count.get("s3")! / avg).toBeGreaterThan(1.5);
    expect(count.get("s7")! / avg).toBeGreaterThan(1.5);
  });

  it("o baralho continua de música para música e entre aberturas (guardado)", () => {
    const store = memoryBagStore();
    const a = new ScenePicker(fake(40), store);
    const first = Array.from({ length: 25 }, () => a.next(ctx()));
    const b = new ScenePicker(fake(40), store); // o visualizador voltou a abrir
    const rest = Array.from({ length: 15 }, () => b.next(ctx()));
    expect(new Set([...first, ...rest]).size).toBe(40);
  });

  it("pelo estilo fica na família; o nível do aparelho tira as caras", () => {
    const p = new ScenePicker(fake(100));
    const byId = new Map(fake(100).map((m) => [m.id, m]));
    for (let i = 0; i < 60; i++) {
      const m = byId.get(p.next(ctx({ selection: "style", family: "calm", tier: 1 })))!;
      expect(m.families).toContain("calm");
      expect(m.cost).toBe(1);
    }
  });

  it("peek diz qual vem a seguir, e next devolve essa", () => {
    const p = new ScenePicker(fake(50));
    for (let i = 0; i < 30; i++) {
      const k = p.peek(ctx());
      expect(p.next(ctx())).toBe(k);
    }
  });

  it("as etiquetas da música dão peso", () => {
    const r = rng(11);
    let hits = 0;
    for (let k = 0; k < 2000; k++) {
      const p = new ScenePicker(fake(100), undefined, r);
      if (/^s\d*0$/.test(p.next(ctx({ songTags: "fado lisboa" })))) hits++;
    }
    expect(hits / 2000).toBeGreaterThan(0.15); // 10 % das cenas são "fado"; com o peso a dobrar, ~18 %
  });
});
