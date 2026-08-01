/**
 * Per-user SQLite open + migrations runner. Each account gets its own
 * database file (oms-music-<userId>.db) and its own download directory, which
 * resolves account switching with no shared-store purge logic (DESIGN 9.1).
 */
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { MIGRATIONS } from "./schema";
import type { UserId } from "@/domain/ids";

const openDbs = new Map<string, SQLiteDatabase>();

export const databaseNameForUser = (userId: UserId): string => `oms-music-${userId}.db`;

const readSchemaVersion = (db: SQLiteDatabase): number => {
  try {
    const row = db.getFirstSync<{ value: string | null }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    const parsed = row?.value ? Number(row.value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0; // meta table absent = fresh database
  }
};

const runMigrations = (db: SQLiteDatabase): void => {
  const current = readSchemaVersion(db);
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.execSync(MIGRATIONS[version]);
    db.runSync(
      "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(version + 1)],
    );
  }
};

/** Opens (or returns) the migrated per-user database. */
export const openUserDb = (userId: UserId): SQLiteDatabase => {
  const name = databaseNameForUser(userId);
  const existing = openDbs.get(name);
  if (existing) return existing;
  const db = openDatabaseSync(name);
  runMigrations(db);
  openDbs.set(name, db);
  return db;
};

/** Closes an open handle (tests / account switch hygiene). Files persist. */
export const closeUserDb = (userId: UserId): void => {
  const name = databaseNameForUser(userId);
  const db = openDbs.get(name);
  if (!db) return;
  try {
    db.closeSync();
  } catch {
    // Already closed.
  }
  openDbs.delete(name);
};
