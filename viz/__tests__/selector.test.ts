import { describe, expect, it } from "bun:test";
import { FULL_SCENES, SCENE_FAMILIES } from "../protocol";
import { familyFor, ScenePicker } from "../selector";

const song = (tags: string[], bpm: number | null = null) => ({ id: "1", title: "t", artist: "a", artworkUrl: null, tags, bpm });

describe("escolha das cenas", () => {
  it("os géneros mandam", () => {
    expect(familyFor(song(["hardstyle"]), null)).toBe("chaos");
    expect(familyFor(song(["Hyperpop", "digicore"]), null)).toBe("chaos");
    expect(familyFor(song(["fado"]), null)).toBe("calm");
    expect(familyFor(song(["acoustic"]), null)).toBe("calm");
    expect(familyFor(song(["synthwave"]), null)).toBe("electronic");
  });

  it("sem géneros, o andamento e a energia", () => {
    const loud = { fps: 25, bpm: 160, beats: new Float64Array(), onsets: new Float64Array(), env: new Uint8Array(100).fill(220), bands: [] };
    const soft = { ...loud, bpm: 80, env: new Uint8Array(100).fill(90) };
    expect(familyFor(song([]), loud)).toBe("chaos");
    expect(familyFor(song([]), soft)).toBe("calm");
  });

  it("nunca repete a mesma seguida, nunca dá uma banida, e há mais de 20", () => {
    expect(FULL_SCENES.length).toBeGreaterThanOrEqual(20);
    const p = new ScenePicker();
    let last = "";
    for (let i = 0; i < 200; i++) {
      const s = p.next("random", "retro", ["ink"], ["desktop", "vhs"]);
      expect(s).not.toBe(last);
      expect(["desktop", "vhs"]).not.toContain(s);
      last = s;
    }
  });

  it("pelo estilo fica na família", () => {
    const p = new ScenePicker();
    for (let i = 0; i < 40; i++) expect(SCENE_FAMILIES.calm).toContain(p.next("style", "calm", [], []));
  });
});
