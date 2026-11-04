/**
 * O estado da Montagem fora do React: se está ligada (guardado no aparelho:
 * ligada, cada música com montagem toca-a sozinha no visualizador) e a
 * montagem que está a passar agora (a guardada ou a que se está a fazer).
 */
import { useSyncExternalStore } from "react";
import { kvGet, kvSet } from "@/db/kv";
import type { MontageSpec } from "../../../montage/protocol";

const KEY = "montage.on";

interface State {
  on: boolean;
  live: MontageSpec | null;
}

let state: State = { on: kvGet(KEY) !== "0", live: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getMontageState = (): State => state;

export const setMontageOn = (on: boolean): void => {
  kvSet(KEY, on ? "1" : "0");
  state = { ...state, on };
  emit();
};

export const setLiveMontage = (live: MontageSpec | null): void => {
  state = { ...state, live };
  emit();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const useMontageState = (): State => useSyncExternalStore(subscribe, () => state, () => state);
