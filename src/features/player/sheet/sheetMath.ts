/**
 * A decisão da folha do leitor ao largar o dedo (ronda 2): abrir ou fechar
 * pela velocidade primeiro (um gesto rápido manda, mesmo curto), e pela
 * posição quando o dedo pára. Pura e "worklet": corre na thread da UI no
 * nativo e igual na web.
 */

/** px/s acima dos quais a direcção do gesto decide sozinha. */
export const SHEET_FLING_VELOCITY = 650;

/**
 * `progress`: 0 fechada, 1 aberta. `velocityY`: px/s, positivo para baixo.
 * Devolve 1 (abrir) ou 0 (fechar).
 */
export function sheetSnapTarget(progress: number, velocityY: number): 0 | 1 {
  "worklet";
  if (velocityY > SHEET_FLING_VELOCITY) return 0;
  if (velocityY < -SHEET_FLING_VELOCITY) return 1;
  return progress > 0.5 ? 1 : 0;
}

export function clampProgress(value: number): number {
  "worklet";
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A mola das duas plataformas: rápida, sem ressalto visível. */
export const SHEET_SPRING = { damping: 30, stiffness: 300, mass: 0.9, overshootClamping: true } as const;
