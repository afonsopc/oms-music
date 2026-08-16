/**
 * A matemática do modo adormecer. As regras que fixa: só temporizadores por
 * minutos entram na janela; fora dela devolve-se null (o engine restaura);
 * o volume cai em p^2 e o rate desce linearmente até ao chão proporcional.
 */
import { describe, expect, test } from "bun:test";
import {
  computeSleepFade,
  SLEEP_FADE_RATE_FLOOR,
  SLEEP_FADE_WINDOW_MS,
  sleepFadeProgress,
} from "../sleepFade";

describe("sleepFadeProgress", () => {
  test("1 fora da janela, 0 no fim, linear no meio", () => {
    expect(sleepFadeProgress(SLEEP_FADE_WINDOW_MS + 1)).toBe(1);
    expect(sleepFadeProgress(SLEEP_FADE_WINDOW_MS)).toBe(1);
    expect(sleepFadeProgress(SLEEP_FADE_WINDOW_MS / 2)).toBeCloseTo(0.5);
    expect(sleepFadeProgress(0)).toBe(0);
    expect(sleepFadeProgress(-5_000)).toBe(0);
  });
});

describe("computeSleepFade", () => {
  const endsAt = 1_000_000;
  const minutes = (remainingMs: number) => ({ minutes: 30, endsAt });

  test("sem temporizador ou com end-of-song, nada a aplicar", () => {
    expect(computeSleepFade(null, 0, 1, 1)).toBeNull();
    expect(computeSleepFade({ endOfSong: true }, 0, 1, 1)).toBeNull();
  });

  test("fora da janela devolve null (o engine nao toca no player)", () => {
    const now = endsAt - SLEEP_FADE_WINDOW_MS - 10_000;
    expect(computeSleepFade(minutes(0), now, 1, 1)).toBeNull();
  });

  test("a meio da janela: volume em p^2, rate a meio caminho do chao", () => {
    const now = endsAt - SLEEP_FADE_WINDOW_MS / 2;
    const targets = computeSleepFade(minutes(0), now, 0.8, 1);
    expect(targets).not.toBeNull();
    expect(targets?.volume).toBeCloseTo(0.8 * 0.25);
    expect(targets?.rate).toBeCloseTo(SLEEP_FADE_RATE_FLOOR + (1 - SLEEP_FADE_RATE_FLOOR) / 2);
  });

  test("no disparo: volume zero, rate no chao", () => {
    const targets = computeSleepFade(minutes(0), endsAt, 1, 1);
    expect(targets?.volume).toBe(0);
    expect(targets?.rate).toBeCloseTo(SLEEP_FADE_RATE_FLOOR);
  });

  test("os alvos sao proporcionais as preferencias do utilizador", () => {
    const targets = computeSleepFade(minutes(0), endsAt, 0.5, 2);
    expect(targets?.volume).toBe(0);
    expect(targets?.rate).toBeCloseTo(2 * SLEEP_FADE_RATE_FLOOR);
  });
});
