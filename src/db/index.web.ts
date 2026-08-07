/**
 * Web fork of db/index (Metro picks .web.ts): the downloads manager - the
 * only caller - never starts on web (downloads/register gates the session
 * lifecycle), so this exists purely so the bundle does not pull expo-sqlite's
 * web worker and its wa-sqlite.wasm asset in. Calling it anyway is a bug and
 * says so.
 */
import type { SQLiteDatabase } from "expo-sqlite";
import type { UserId } from "@/domain/ids";

export const databaseNameForUser = (userId: UserId): string => `oms-music-${userId}.db`;

export const openUserDb = (_userId: UserId): SQLiteDatabase => {
  throw new Error("openUserDb: the downloads database does not exist on web.");
};

export const closeUserDb = (_userId: UserId): void => {
  // Nothing was ever opened.
};
