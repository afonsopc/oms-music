/**
 * O que um arrasto no mini-leitor quer dizer (só no nativo). Puro e sem
 * imports, para correr no worklet do gesto e nos testes:
 *
 *  - para a esquerda: a seguinte; para a direita: a anterior;
 *  - para cima: abre o leitor;
 *  - curto ou indeciso: nada (a pílula volta ao sítio).
 */
export type MiniSwipe = "next" | "previous" | "open" | null;

/** Distância horizontal que conta como "mudar de música". */
export const MINI_SWIPE_X = 64;
/** Distância para cima que abre o leitor. */
export const MINI_SWIPE_UP = 36;
/** Velocidade (px/s) que conta mesmo com pouca distância. */
export const MINI_SWIPE_VELOCITY = 650;

export function miniSwipeDecision(dx: number, dy: number, vx: number, vy: number): MiniSwipe {
  "worklet";
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (horizontal) {
    const far = Math.abs(dx) > MINI_SWIPE_X;
    const fast = Math.abs(dx) > 16 && Math.abs(vx) > MINI_SWIPE_VELOCITY;
    if (!far && !fast) return null;
    return dx < 0 ? "next" : "previous";
  }
  if (dy < -MINI_SWIPE_UP || (dy < -12 && vy < -MINI_SWIPE_VELOCITY)) return "open";
  return null;
}
