/**
 * Modo adormecer (ideia 3.10 do dono, 2026-08-17): em vez de o temporizador
 * cortar o som a meio de uma faixa, o último minuto desce o volume e abranda
 * ligeiramente a velocidade - e como o adapter corre com
 * shouldCorrectPitch=false, abrandar É baixar o pitch, o disco a perder
 * corda. Este módulo é a metade PURA: dado o estado do temporizador e o
 * relógio, diz que volume e rate aplicar. O engine só aplica.
 *
 * Regras:
 *  - só temporizadores por MINUTOS (endsAt); o end-of-song não tem janela
 *    de parede conhecida e fica como está;
 *  - fora da janela devolve null (nada a aplicar / restaurar);
 *  - o volume cai em p^2: quase imperceptível no início da janela, a
 *    desaparecer no fim - a percepção de volume é logarítmica e uma descida
 *    linear soa a queda brusca no fim;
 *  - o rate desce linearmente até RATE_FLOOR x o rate do utilizador,
 *    proporcional para respeitar quem já ouve a 1.5x.
 */
import type { SleepTimerState } from "./sleepTimer";

export const SLEEP_FADE_WINDOW_MS = 60_000;
export const SLEEP_FADE_RATE_FLOOR = 0.85;

/** 1 fora da janela, 0 no instante em que o temporizador dispara. */
export const sleepFadeProgress = (
  remainingMs: number,
  windowMs: number = SLEEP_FADE_WINDOW_MS,
): number => {
  if (remainingMs >= windowMs) return 1;
  if (remainingMs <= 0) return 0;
  return remainingMs / windowMs;
};

export interface SleepFadeTargets {
  volume: number;
  rate: number;
}

/**
 * O que o player deve receber AGORA, ou null quando nenhum fade se aplica
 * (sem temporizador, temporizador end-of-song, ou ainda fora da janela).
 * userVolume/userRate são os valores do utilizador na loja - os alvos são
 * factores sobre eles, nunca substitutos.
 */
export const computeSleepFade = (
  state: SleepTimerState,
  nowMs: number,
  userVolume: number,
  userRate: number,
): SleepFadeTargets | null => {
  if (!state || !("endsAt" in state)) return null;
  const remaining = state.endsAt - nowMs;
  const p = sleepFadeProgress(remaining);
  if (p >= 1) return null;
  return {
    volume: userVolume * p * p,
    rate: userRate * (SLEEP_FADE_RATE_FLOOR + (1 - SLEEP_FADE_RATE_FLOOR) * p),
  };
};
