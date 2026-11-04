import { describe, expect, it } from "bun:test";
import { AA_NORMAL, contrastRatio } from "../contrast";
import { neutralTint, tintFromAccent } from "../tint";
import { LIKED_INK, LIKED_WASH, MIX_KIND_TINTS, RADIO_KIND_TINTS, darkTokens, lightTokens } from "../tokens";

describe("tons calmos (ronda 2)", () => {
  it("o texto das mixes lê-se sobre o fundo, nos dois temas", () => {
    for (const [kind, tint] of [...Object.entries(MIX_KIND_TINTS), ...Object.entries(RADIO_KIND_TINTS)]) {
      for (const scheme of ["light", "dark"] as const) {
        const ratio = contrastRatio(tint[scheme].ink, tint[scheme].wash);
        expect({ kind, scheme, ok: ratio >= AA_NORMAL }).toEqual({ kind, scheme, ok: true });
      }
    }
  });

  it("o lilás das Gostadas lê-se no fundo do tema e no seu", () => {
    expect(contrastRatio(LIKED_INK.dark, darkTokens.background)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(LIKED_INK.light, lightTokens.background)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(LIKED_INK.dark, LIKED_WASH.dark)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(LIKED_INK.light, LIKED_WASH.light)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("o texto do tema lê-se sobre o tom de qualquer capa", () => {
    const samples = ["#ff0000", "#00ff88", "#1a1a1a", "#f5f5f5", "#3355ff", "#996633", "#000000", "#ffffff"];
    for (const accent of samples) {
      const dark = tintFromAccent(accent, "dark");
      const light = tintFromAccent(accent, "light");
      expect(contrastRatio(darkTokens.foreground, dark.wash)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(lightTokens.foreground, light.wash)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
    expect(contrastRatio(darkTokens.foreground, neutralTint("dark").wash)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
