import { describe, expect, it } from "bun:test";
import en from "../catalogs/en.json";
import pt from "../catalogs/pt.json";
import lv from "../catalogs/lv.json";

type Tree = Record<string, unknown>;

const keyPaths = (node: unknown, prefix = ""): string[] => {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      keyPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
};

describe("i18n catalogs", () => {
  it("have identical key trees across en/pt/lv", () => {
    const enKeys = keyPaths(en).sort();
    const ptKeys = keyPaths(pt).sort();
    const lvKeys = keyPaths(lv).sort();
    expect(ptKeys).toEqual(enKeys);
    expect(lvKeys).toEqual(enKeys);
  });

  it("contain no em-dash anywhere", () => {
    for (const catalog of [en, pt, lv]) {
      expect(JSON.stringify(catalog).includes("\u{2014}")).toBeFalsy();
    }
  });

  it("keep the components.music.mixLabels keys the mix payloads reference", () => {
    const labels = (en as Tree)["components"] as Tree;
    const music = labels["music"] as Tree;
    const mixLabels = music["mixLabels"] as Tree;
    const title = mixLabels["title"] as Tree;
    for (const key of ["topArtist", "repeatRewind", "timeCapsule", "discoveries"]) {
      expect(typeof title[key]).toBe("string");
    }
  });
});
