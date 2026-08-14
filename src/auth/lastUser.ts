/**
 * The last signed-in user id, remembered across launches.
 *
 * It used to live inside `downloads/register.ts`, BELOW that module's
 * `Platform.OS === "web"` early return, and that placement was quietly load
 * bearing for something else entirely: `api/persistCache.ts` keys its
 * dehydrated react-query snapshot on the same kv entry. So on web - and
 * therefore inside the Tauri shell, which IS web - the memo was never
 * written, `snapshotKey()` was always null, `hydrateQueryCache()` returned
 * immediately and `write()` returned immediately. The entire disk-persisted
 * query cache was dead code on both, and nobody could see it because the
 * feature degrades silently into "the network answers instead".
 *
 * Hoisting the memo here fixes that for every platform at once, which is what
 * makes "the basics render with zero requests on a warm boot" true on desktop
 * and in a plain browser tab, not just on native.
 *
 * Deliberately tiny and deliberately NOT part of the session store: it must
 * survive a signed-out boot (an offline launch keeps the token but resolves
 * no account payload) and it must be readable synchronously, before any
 * provider mounts.
 */
import { kvGet, kvSet } from "@/db/kv";
import type { UserId } from "@/domain/ids";
import { useSessionStore } from "./session";

/** Frozen: `downloads/register.ts` and `api/persistCache.ts` shared this
 *  literal long before this module existed, and the value on disk predates
 *  it too. Renaming it would orphan every existing snapshot. */
export const LAST_USER_KV_KEY = "oms-music.downloads.last-user-id";

/** Write-through, but only on a real change: kv writes hit SQLite. */
export const rememberUser = (userId: UserId): void => {
  if (!userId) return;
  if (kvGet(LAST_USER_KV_KEY) === userId) return;
  kvSet(LAST_USER_KV_KEY, userId);
};

export const lastUserId = (): UserId | null => {
  const remembered = kvGet(LAST_USER_KV_KEY);
  return remembered ? (remembered as UserId) : null;
};

/**
 * The id of the account this process is currently serving: the live session
 * when it has resolved, the memo otherwise. An OFFLINE boot never resolves an
 * account payload, so the memo is what lets the downloaded library (and the
 * persisted query cache) open at all in airplane mode.
 */
export const resolveUserId = (): UserId | null => {
  const state = useSessionStore.getState();
  if (state.status !== "authed") return null;
  const known = state.user?.id ?? state.session?.user_id ?? null;
  if (known) {
    rememberUser(known);
    return known;
  }
  return lastUserId();
};

let registered = false;

/**
 * Subscribes to the session store on EVERY platform. Idempotent, and wired as
 * step 0 of boot: everything that reads the memo (the query-cache snapshot,
 * the downloads manager, the desktop cache session) must find it already
 * current, never one sign-in behind.
 */
export const registerLastUserMemo = (): void => {
  if (registered) return;
  registered = true;
  const capture = (): void => {
    const state = useSessionStore.getState();
    if (state.status !== "authed") return;
    const known = state.user?.id ?? state.session?.user_id ?? null;
    if (known) rememberUser(known);
  };
  useSessionStore.subscribe(capture);
  capture();
};
