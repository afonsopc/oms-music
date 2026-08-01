/**
 * Folder-import resume tracker (FR-100), pure half. Ported from the web
 * `lib/importTracker.ts` (IndexedDB there, kv-store here - see
 * folderTrackerStore.ts):
 *
 *  - a record is keyed by the folder name (`path`) and holds the file names
 *    that succeeded and failed;
 *  - a retry skips everything already in `success`;
 *  - "ignore" moves a failed file into `success` (the user accepted the
 *    loss); a record whose two lists are empty is dropped;
 *  - a folder whose files ALL succeeded deletes its record.
 *
 * Every reducer is pure so the resume semantics are bun-testable without a
 * device.
 */

export interface ImportStatus {
  success: string[];
  failed: string[];
}

export interface ImportRecord {
  /** Folder name; the tracker key. */
  path: string;
  status: ImportStatus;
}

export type ImportRecords = Record<string, ImportRecord>;

const emptyRecord = (path: string): ImportRecord => ({
  path,
  status: { success: [], failed: [] },
});

const withRecord = (
  records: ImportRecords,
  path: string,
  update: (record: ImportRecord) => ImportRecord,
): ImportRecords => {
  const current = records[path] ?? emptyRecord(path);
  return { ...records, [path]: update(current) };
};

const addUnique = (list: string[], value: string): string[] =>
  list.includes(value) ? list : [...list, value];

export const getRecord = (records: ImportRecords, path: string): ImportRecord | null =>
  records[path] ?? null;

/** Files still to import: everything not already recorded as a success. */
export const pendingFiles = <T extends { relativePath: string; name: string }>(
  record: ImportRecord | null,
  files: readonly T[],
): T[] => {
  if (!record) return files.slice();
  const done = new Set(record.status.success);
  return files.filter((file) => !done.has(fileKey(file)));
};

/** Tracker key for a picked file: the folder-relative path, else the name. */
export const fileKey = (file: { relativePath: string; name: string }): string =>
  file.relativePath || file.name;

export const markSuccess = (
  records: ImportRecords,
  path: string,
  fileName: string,
): ImportRecords =>
  withRecord(records, path, (record) => ({
    path,
    status: {
      success: addUnique(record.status.success, fileName),
      failed: record.status.failed.filter((entry) => entry !== fileName),
    },
  }));

export const markFailure = (
  records: ImportRecords,
  path: string,
  fileName: string,
): ImportRecords =>
  withRecord(records, path, (record) => ({
    path,
    status: {
      success: record.status.success,
      failed: addUnique(record.status.failed, fileName),
    },
  }));

export const deleteRecord = (records: ImportRecords, path: string): ImportRecords => {
  const next = { ...records };
  delete next[path];
  return next;
};

/**
 * "Ignore this file": it moves to success. When both lists end up empty the
 * record disappears (web parity: removeFailedFile).
 */
export const ignoreFailure = (
  records: ImportRecords,
  path: string,
  fileName: string,
): ImportRecords => {
  const record = records[path];
  if (!record) return records;
  const failed = record.status.failed.filter((entry) => entry !== fileName);
  const success = addUnique(record.status.success, fileName);
  if (failed.length === 0 && success.length === 0) return deleteRecord(records, path);
  return { ...records, [path]: { path, status: { success, failed } } };
};

/** A run is complete when nothing failed and every folder file succeeded. */
export const isFolderComplete = (record: ImportRecord | null, totalFiles: number): boolean =>
  !!record && record.status.failed.length === 0 && record.status.success.length >= totalFiles;

/** Records worth surfacing as an "incomplete import" warning card. */
export const incompleteRecords = (records: ImportRecords): ImportRecord[] =>
  Object.values(records).filter((record) => record.status.failed.length > 0);
