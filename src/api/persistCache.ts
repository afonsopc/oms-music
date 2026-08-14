/**
 * Query-cache persistence (local-first, owner request 2026-08-10): the whole
 * react-query cache is dehydrated to the kv store so the NEXT launch renders
 * the library from disk in the first frame and revalidates in the background
 * (stale-while-revalidate). No extra packages: dehydrate/hydrate ship in the
 * react-query core.
 *
 *  - Only SUCCESSFUL queries persist; errors and in-flight states do not.
 *  - The snapshot is keyed by the last signed-in user (the downloads
 *    subsystem's memo), so user switches never leak one account's library
 *    into another - logout also wipes the snapshot outright.
 *  - Entries older than MAX_AGE_MS are dropped at hydrate time; a VERSION
 *    bump discards every old snapshot at once (shape changes).
 *  - Writes are debounced: the cache updates in bursts (a screenful of
 *    queries settling), one serialize covers all of them.
 *
 * Presigned URLs never live in react-query (the player's resolver caches by
 * fs node id outside of it), so nothing here can persist an expired URL.
 */
import { dehydrate, hydrate } from "@tanstack/react-query";
import { lastUserId } from "@/auth/lastUser";
import { registerLogoutTask } from "@/auth/session";
import { kvGet, kvRemove, kvSet } from "@/db/kv";
import { queryClient } from "./queryClient";

/** Bump to throw every existing snapshot away (persisted shape change). */
// v3: the media-id migration renamed every persisted wire field
// (*_fs_node_id -> *_media_id); pre-update snapshots would hydrate rows the
// new readers see as artwork-less and source-less until revalidation.
const VERSION = 3;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 5_000;

/**
 * Only the LIGHT list queries persist - the ones that paint the first screen
 * (library rosters, playlists, rails, liked ids). Persisting everything made
 * the snapshot grow to megabytes once the warm-up filled every playlist's
 * song pages, and the SYNCHRONOUS JSON.parse of that at boot is exactly the
 * splash-screen hang the owner reported (2026-08-11). The heavy caches are
 * rebuilt by the warm sweep seconds after launch instead.
 */
const PERSIST_PREFIXES: readonly (readonly string[])[] = [
  ["playlists", "list"],
  ["albums", "list"],
  ["artists", "list"],
  ["liked", "ids"],
  ["mixes", "list"],
  ["playEvents"],
];

const shouldPersist = (queryKey: readonly unknown[]): boolean =>
  PERSIST_PREFIXES.some((prefix) => prefix.every((seg, i) => queryKey[i] === seg));

/**
 * The memo now lives in auth/lastUser.ts, written on EVERY platform.
 *
 * It used to be written only by downloads/register.ts, below that module's
 * web early-return, so on web and inside the Tauri shell this function always
 * answered null - hydrate and write both returned at their first line and the
 * whole persisted cache was inert. That is why the fix is a one-import change
 * here and a win for plain `music.omelhorsite.pt` as much as for the desktop
 * shell.
 */
const snapshotKey = (): string | null => {
  const userId = lastUserId();
  return userId ? `oms-music.query-cache.${userId}` : null;
};

/**
 * @internal Exported for the regression test that proves the key is non-null
 * after a sign-in on web - the exact condition that was silently false and
 * turned this whole module into dead code there.
 */
export const snapshotKeyForTests = (): string | null => snapshotKey();

interface Snapshot {
  version: number;
  at: number;
  state: unknown;
}

/** Load the previous session's cache into the client. Call ONCE, at boot. */
export const hydrateQueryCache = (): void => {
  const key = snapshotKey();
  if (!key) return;
  const raw = kvGet(key);
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw) as Snapshot;
    if (snapshot.version !== VERSION) return;
    if (Date.now() - snapshot.at > MAX_AGE_MS) return;
    hydrate(queryClient, snapshot.state);
  } catch {
    // A corrupt snapshot just means a cold boot.
  }
};

let writeTimer: ReturnType<typeof setTimeout> | null = null;

const write = (): void => {
  const key = snapshotKey();
  if (!key) return;
  try {
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && shouldPersist(query.queryKey),
    });
    kvSet(key, JSON.stringify({ version: VERSION, at: Date.now(), state }));
  } catch {
    // Serialization is best-effort; the in-memory cache stays correct.
  }
};

const scheduleWrite = (): void => {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    write();
  }, WRITE_DEBOUNCE_MS);
};

/** Start mirroring cache changes to disk. Call ONCE, after hydration. */
export const startQueryCachePersistence = (): void => {
  queryClient.getQueryCache().subscribe(scheduleWrite);
  // Logout wipes the snapshot BEFORE the cache reset lands back on disk:
  // the next user must never hydrate the previous user's library.
  registerLogoutTask(() => {
    const key = snapshotKey();
    if (key) kvRemove(key);
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
  });
};
