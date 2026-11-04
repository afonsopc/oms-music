/**
 * O atraso da letra deste aparelho (definições, "Atraso da letra"): para as
 * saídas de som que o sistema não declara (umas colunas Bluetooth, um
 * recetor ligado por cabo óptico), em que a voz chega depois do que o
 * leitor diz. Positivo atrasa a letra. Fica no aparelho, não na conta: cada
 * aparelho tem a sua saída. Soma-se ao acerto por música (o do servidor).
 */
import { create } from "zustand";
import { kvGetJson, kvSetJson } from "@/db/kv";

const KEY = "oms-music.lyrics.delayMs";
export const LYRICS_DELAY_MIN_MS = -500;
export const LYRICS_DELAY_MAX_MS = 800;
export const LYRICS_DELAY_STEP_MS = 20;

const clamp = (ms: number): number =>
  Math.round(Math.min(Math.max(Number.isFinite(ms) ? ms : 0, LYRICS_DELAY_MIN_MS), LYRICS_DELAY_MAX_MS));

export const useLyricsDelay = create<{ ms: number }>(() => ({ ms: clamp(kvGetJson<number>(KEY) ?? 0) }));

export const setLyricsDelay = (ms: number): void => {
  const next = clamp(ms);
  useLyricsDelay.setState({ ms: next });
  kvSetJson(KEY, next);
};

export const lyricsDelayMs = (): number => useLyricsDelay.getState().ms;
