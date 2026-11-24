/**
 * The store behind the floating notices (boot/notices.tsx renders it). Apart
 * from the surface so any feature can speak without importing the boot layer.
 */
import type { IcuParams } from "@/i18n/icu";

const MAX_VISIBLE = 3;

export interface Notice {
  id: number;
  key: string;
  params?: IcuParams;
}

let nextId = 1;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const cb of listeners) cb();
};

export const subscribeNotices = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const getNotices = (): Notice[] => notices;

/** Adds a notice; identical consecutive keys collapse into the newest one. */
export const pushNotice = (key: string, params?: IcuParams): void => {
  const withoutDuplicate = notices.filter((n) => n.key !== key);
  const notice: Notice = { id: nextId, key, params };
  nextId += 1;
  notices = [...withoutDuplicate, notice].slice(-MAX_VISIBLE);
  emit();
};

export const dismissNotice = (id: number): void => {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  notices = next;
  emit();
};
