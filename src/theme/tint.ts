/**
 * O tom da capa (ronda 2 do redesenho, 2026-11-04): o dono achou o preto
 * total deprimente. A base continua neutra; a cor vem da capa que está a
 * tocar ou da coleção aberta, sempre lavada e calma, nunca berrante.
 *
 *  - `wash`: o fundo tingido (doca do leitor, cabeçalho da coleção, fundo do
 *    leitor). No escuro, um pouco da cor sobre o quase preto; no claro, um
 *    pastel sobre o branco.
 *  - `ink`: a mesma cor mais viva, para detalhes pequenos (o traço do
 *    progresso, o coração das Gostadas) que têm de ler nos dois temas.
 *
 * Puro, para os testes; o hook vive em theme/useArtworkTint.
 */
import { hexToRgb, mixHex, saturateHex } from "./accentMath";
import { contrastRatio } from "./contrast";

export interface Tint {
  wash: string;
  ink: string;
}

const DARK_BASE = "#0a0a0a";
const LIGHT_BASE = "#fafafa";
const DARK_TEXT = "#ebebeb";
const LIGHT_TEXT = "#171717";
/** Folga acima do AA (4,5) para o texto secundário também passar. */
const MIN_TEXT = 7;

/** Luminância relativa aproximada (0 a 1), só para afinar a mistura. */
const luma = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/**
 * `accent` é a cor média da capa já trabalhada (songAccentVariants): a
 * variante escura no tema escuro, a clara no claro.
 */
export const tintFromAccent = (accent: string, scheme: "light" | "dark"): Tint => {
  const vivid = saturateHex(accent, 12);
  if (scheme === "dark") {
    // Capas quase pretas ficam quase pretas: sobe a mistura quando a cor é
    // escura, para o tom se notar sem ficar lamacento.
    let share = luma(vivid) < 0.12 ? 58 : 42;
    // Uma capa clara nunca pode clarear o fundo ao ponto de o texto custar.
    while (share > 6 && contrastRatio(DARK_TEXT, mixHex(vivid, DARK_BASE, share)) < MIN_TEXT) share -= 4;
    return {
      wash: mixHex(vivid, DARK_BASE, share),
      ink: mixHex(vivid, "#ffffff", 45),
    };
  }
  let share = 26;
  while (share > 6 && contrastRatio(LIGHT_TEXT, mixHex(vivid, LIGHT_BASE, share)) < MIN_TEXT) share -= 4;
  return {
    wash: mixHex(vivid, LIGHT_BASE, share),
    ink: mixHex(vivid, "#000000", 70),
  };
};

/** Sem capa (ou a extrair): o neutro do tema, para nunca piscar outra cor. */
export const neutralTint = (scheme: "light" | "dark"): Tint =>
  scheme === "dark" ? { wash: "#161616", ink: "#d4d4d4" } : { wash: "#ededed", ink: "#3a3a3a" };
