/**
 * As cores da capa do DJ. Ate 2026-11-04 mudavam com o estilo que estava a
 * dar (onze paletas, roxos, laranjas, rosas); o redesenho (docs/redesenho.md,
 * "O padrao") pos a interface toda em neutros: a capa do DJ e carvao, a luz
 * que gira e um brilho cinzento e a voz e branca. A cor vem das capas das
 * musicas, nunca da interface.
 */
export interface DjPalette {
  /** As tres paragens do brilho que gira por tras das barras. */
  lights: readonly [string, string, string];
  /** A cor das barras da voz (e do icone). */
  voice: string;
}

export const DJ_PALETTE: DjPalette = {
  lights: [ "#141414", "#2b2b2b", "#141414" ],
  voice: "#ffffff",
};
