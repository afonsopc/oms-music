/**
 * A aritmética do visor de stories (Rewind, previews de artista), pura para
 * o bun test: avanço/recuo com limites, e o progresso das barras
 * segmentadas do topo - cheias atrás, a encher na actual, vazias à frente.
 */

/** null = passou do fim (o chamador fecha o visor). */
export const nextStoryIndex = (index: number, count: number): number | null =>
  index + 1 >= count ? null : index + 1;

/** Recuar na primeira fica na primeira (o idioma do Instagram). */
export const prevStoryIndex = (index: number): number => Math.max(0, index - 1);

/** Largura (0..1) do segmento i quando a story `index` leva `progress`. */
export const segmentFill = (i: number, index: number, progress: number): number => {
  if (i < index) return 1;
  if (i > index) return 0;
  return Math.min(1, Math.max(0, progress));
};

/** Progresso seguinte dado um passo de relógio; >= 1 significa "avança". */
export const tickProgress = (progress: number, dtMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : progress + dtMs / durationMs;
