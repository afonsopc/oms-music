/**
 * As cores da estacao, tiradas do que esta a dar (dono, 2026-08-31: "luzes a
 * girar a volta dependendo do estilo de musica").
 *
 * As etiquetas sao do Last.fm e sao de gente: nao ha lista fechada nem vale
 * a pena fingir que ha. A regra e por SUBSTRING e a primeira que bater
 * ganha, o que faz "hyperpop", "pop punk" e "synthpop" caírem em sitios
 * diferentes sem precisarem de entrada propria.
 */
export interface DjPalette {
  /** As tres cores da luz que gira. */
  lights: readonly [string, string, string];
  /** A cor das barras da voz, por cima da luz. */
  voice: string;
}

const PALETTES: readonly (readonly [string[], DjPalette])[] = [
  [ [ "hyperpop", "digicore", "glitch", "nightcore" ],
    { lights: [ "#ff2d95", "#00e5ff", "#a855f7" ], voice: "#ffffff" } ],
  [ [ "fado", "portuguese", "bolero", "tango", "chanson" ],
    { lights: [ "#7f1d1d", "#b45309", "#1c1917" ], voice: "#fde68a" } ],
  [ [ "hardstyle", "hardcore", "jumpstyle", "gabber", "techno", "rave" ],
    { lights: [ "#dc2626", "#f97316", "#171717" ], voice: "#ffffff" } ],
  [ [ "metal", "punk", "rock" ],
    { lights: [ "#7c2d12", "#dc2626", "#111827" ], voice: "#fca5a5" } ],
  [ [ "house", "electronic", "edm", "dance", "trance", "drum and bass" ],
    { lights: [ "#2563eb", "#06b6d4", "#7c3aed" ], voice: "#ffffff" } ],
  [ [ "hip hop", "rap", "trap", "drill" ],
    { lights: [ "#111827", "#4c1d95", "#f59e0b" ], voice: "#fcd34d" } ],
  [ [ "jazz", "soul", "blues", "funk" ],
    { lights: [ "#78350f", "#c2410c", "#1e293b" ], voice: "#fed7aa" } ],
  [ [ "classical", "ambient", "instrumental", "piano", "lo-fi", "lofi" ],
    { lights: [ "#1e3a8a", "#334155", "#0f172a" ], voice: "#bfdbfe" } ],
  [ [ "k-pop", "kpop", "j-pop", "jpop", "anime" ],
    { lights: [ "#ec4899", "#8b5cf6", "#22d3ee" ], voice: "#ffffff" } ],
  [ [ "country", "folk", "acoustic", "singer-songwriter" ],
    { lights: [ "#365314", "#a16207", "#292524" ], voice: "#fef3c7" } ],
  [ [ "pop", "indie" ],
    { lights: [ "#6366f1", "#ec4899", "#0ea5e9" ], voice: "#ffffff" } ],
];

/** A luz de casa: a mesma do banner do Inicio, para a porta e a sala combinarem. */
export const DEFAULT_PALETTE: DjPalette = {
  lights: [ "#0f172a", "#4338ca", "#c026d3" ],
  voice: "#ffffff",
};

export const paletteFor = (styles: readonly string[]): DjPalette => {
  const tags = styles.map((tag) => tag.toLowerCase());
  for (const [ needles, palette ] of PALETTES) {
    if (tags.some((tag) => needles.some((needle) => tag.includes(needle)))) return palette;
  }
  return DEFAULT_PALETTE;
};
