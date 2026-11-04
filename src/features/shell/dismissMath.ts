/**
 * Quando é que arrastar o player para baixo o fecha: passou de 140 px ou foi
 * um puxão rápido (mais de 900 px/s). O mesmo limite no nativo e na web.
 */
export const DISMISS_DISTANCE = 140;
export const DISMISS_VELOCITY = 900;

export function dismissDecision(dy: number, velocityY: number): boolean {
  "worklet"; // corre no onEnd do Gesture.Pan nativo, na thread da UI
  return dy > DISMISS_DISTANCE || (dy > 12 && velocityY > DISMISS_VELOCITY);
}
