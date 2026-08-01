/**
 * Global import-busy flag (FR-99). The web sets `window.musicImportBusy` so a
 * second import surface disables itself while one is running; native uses
 * this tiny store instead. Every import surface (files, URL, artist) reads it
 * and refuses to start a second run.
 */
import { useSyncExternalStore } from "react";

let busy = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isImportBusy = (): boolean => busy;

export const setImportBusy = (next: boolean): void => {
  if (busy === next) return;
  busy = next;
  emit();
};

export const useImportBusy = (): boolean =>
  useSyncExternalStore(subscribe, isImportBusy, isImportBusy);
