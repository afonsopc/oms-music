/**
 * As contas puras do movimento e das esperas (testáveis no bun, sem React
 * Native): o atraso da cascata e a frase que acompanha uma espera longa.
 */

/** Atraso da entrada em cascata: rápido ao início, nunca mais de ~0,4 s. */
export const staggerDelay = (order: number, step = 40, cap = 400): number =>
  Math.min(Math.max(0, order) * step, cap);

/** Que frase mostrar ao fim de `ms` de espera (null: ainda nenhuma). */
export const waitPhraseKey = (ms: number): "waitSlow" | "waitSlower" | "waitStuck" | null => {
  if (ms >= 20_000) return "waitStuck";
  if (ms >= 6_000) return "waitSlower";
  if (ms >= 2_000) return "waitSlow";
  return null;
};
