/**
 * kv-backed persistence for the folder-import tracker (FR-100). The web keeps
 * this in IndexedDB; DESIGN 9.1 puts folder-import trackers in kv-store.
 * Reducers live in folderTracker.ts (pure, bun-tested); this module only
 * loads, saves and notifies subscribers.
 */
import { useSyncExternalStore } from "react";
import { kvGetJson, kvSetJson } from "@/db/kv";
import {
  deleteRecord,
  ignoreFailure,
  markFailure,
  markSuccess,
  type ImportRecords,
} from "./folderTracker";

const KV_KEY = "oms-music.importTracker";

let records: ImportRecords = kvGetJson<ImportRecords>(KV_KEY) ?? {};
const listeners = new Set<() => void>();

const commit = (next: ImportRecords): void => {
  records = next;
  kvSetJson(KV_KEY, records);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getTrackerRecords = (): ImportRecords => records;

export const useTrackerRecords = (): ImportRecords =>
  useSyncExternalStore(subscribe, getTrackerRecords, getTrackerRecords);

export const trackSuccess = (path: string, fileName: string): void => {
  commit(markSuccess(records, path, fileName));
};

export const trackFailure = (path: string, fileName: string): void => {
  commit(markFailure(records, path, fileName));
};

export const trackIgnore = (path: string, fileName: string): void => {
  commit(ignoreFailure(records, path, fileName));
};

export const forgetFolder = (path: string): void => {
  commit(deleteRecord(records, path));
};
