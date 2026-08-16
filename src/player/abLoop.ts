/**
 * Loop de secção A-B (backlog "loop de secção", v1 MANUAL): quem estuda um
 * instrumento marca o ponto A e o ponto B durante a reprodução e o motor
 * volta a A sempre que chega a B. Sem detecção de compasso - não existe
 * infra-estrutura de análise de áudio e esta versão não a inventa - e sem
 * persistência: o loop é uma ferramenta de ensaio, morre ao trocar de música
 * e nunca sobrevive a um relançamento (por isso persistence.ts não o conhece).
 *
 * Este módulo é só a aritmética pura, sem player nem store, para os testes
 * correrem em bun exactamente como queueOps/gainLaw/sleepFade.
 */

export interface AbLoopState {
  /** Segundos; null = ponto ainda não marcado. */
  a: number | null;
  b: number | null;
}

/**
 * B tem de ficar à frente de A com uma folga audível: um loop de ~0 s seria
 * uma metralhadora de seeks (cada status voltava a disparar o salto) e não
 * repete nada que se ouça.
 */
export const MIN_AB_GAP_S = 0.5;

export const emptyAbLoop = (): AbLoopState => ({ a: null, b: null });

/** Nunca antes do zero; nunca depois do fim quando a duração é conhecida. */
const clampPoint = (position: number, duration: number): number => {
  const floored = Math.max(0, position);
  return duration > 0 ? Math.min(floored, duration) : floored;
};

/**
 * Marca A na posição dada. Um A marcado em cima (ou à frente) de um B já
 * existente invalida esse B - o utilizador está claramente a recomeçar a
 * secção, e manter um B atrás de A daria um intervalo negativo.
 */
export const markA = (state: AbLoopState, position: number, duration: number): AbLoopState => {
  const a = clampPoint(position, duration);
  const b = state.b !== null && state.b - a >= MIN_AB_GAP_S ? state.b : null;
  return { a, b };
};

/**
 * Marca B na posição dada. Um B que não deixe a folga mínima à frente de A é
 * RECUSADO (estado devolvido intacto): a recusa honesta é melhor do que
 * inventar um intervalo que o utilizador não pediu. B pode ser marcado antes
 * de A - o loop simplesmente só arma quando ambos existem.
 */
export const markB = (state: AbLoopState, position: number, duration: number): AbLoopState => {
  const b = clampPoint(position, duration);
  if (state.a !== null && b - state.a < MIN_AB_GAP_S) return state;
  return { a: state.a, b };
};

/** Armado = ambos os pontos marcados (a construção garante b > a). */
export const abLoopActive = (state: AbLoopState): boolean =>
  state.a !== null && state.b !== null;

/**
 * Para onde saltar dado o relógio actual: A quando o loop está armado e a
 * posição alcançou (ou passou) B, null caso contrário. Posições antes de A
 * tocam normalmente até B - o utilizador pode ouvir a entrada da secção.
 */
export const abLoopJumpTarget = (state: AbLoopState, position: number): number | null => {
  if (!abLoopActive(state)) return null;
  return position >= (state.b as number) ? state.a : null;
};
