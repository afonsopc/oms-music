/**
 * The memo that decides whether the disk-persisted query cache exists at all.
 *
 * The bug this closes was invisible for months: `rememberUser` lived inside
 * `downloads/register.ts`, BELOW its `Platform.OS === "web"` early return,
 * while `api/persistCache.ts` keyed its dehydrated snapshot on the same kv
 * entry. So on web - and therefore inside the Tauri shell, which IS web - the
 * entry was never written, `snapshotKey()` was always null, and both
 * `hydrateQueryCache()` and `write()` returned at their first line. The whole
 * feature degraded into "the network answers instead", which looks like
 * slowness rather than a broken code path.
 *
 * Hence the third case below: it asserts the SNAPSHOT KEY, not just the memo,
 * because the memo being right is only half of what was wrong.
 *
 * kv and the session store are mocked because both drag react-native into the
 * import graph and bun cannot parse its Flow types.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { UserId } from "@/domain/ids";

const store = new Map<string, string>();

mock.module("@/db/kv", () => ({
  kvGet: (key: string) => store.get(key) ?? null,
  kvSet: (key: string, value: string) => {
    store.set(key, value);
  },
  kvRemove: (key: string) => {
    store.delete(key);
  },
  kvGetJson: (key: string) => {
    const raw = store.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  kvSetJson: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  },
}));

interface FakeSessionState {
  status: "booting" | "anon" | "authed";
  user: { id: UserId } | null;
  session: { user_id: UserId } | null;
}

let sessionState: FakeSessionState = { status: "anon", user: null, session: null };
const sessionListeners = new Set<() => void>();

mock.module("@/auth/session", () => ({
  useSessionStore: {
    getState: () => sessionState,
    subscribe: (cb: () => void) => {
      sessionListeners.add(cb);
      return () => sessionListeners.delete(cb);
    },
  },
  registerLogoutTask: () => () => {},
}));

// api/queryClient wires NetInfo and AppState at module scope, so it is mocked
// for the same reason: only the snapshot KEY is under test here.
mock.module("@/api/queryClient", () => ({
  queryClient: {
    getQueryCache: () => ({ subscribe: () => () => {} }),
  },
  wireQueryClient: () => {},
}));

const setSession = (next: FakeSessionState): void => {
  sessionState = next;
  for (const cb of sessionListeners) cb();
};

const KEY = "oms-music.downloads.last-user-id";

describe("last user memo", () => {
  beforeEach(() => {
    store.clear();
    sessionState = { status: "anon", user: null, session: null };
  });

  it("round trips through kv and writes only on a change", async () => {
    const { LAST_USER_KV_KEY, lastUserId, rememberUser } = await import("../lastUser");
    expect(LAST_USER_KV_KEY).toBe(KEY);
    expect(lastUserId()).toBeNull();

    rememberUser("user-1" as UserId);
    expect(lastUserId()).toBe("user-1" as UserId);

    // kv writes hit SQLite; an unchanged value must not produce one.
    store.set(KEY, "user-1");
    rememberUser("user-1" as UserId);
    expect(store.get(KEY)).toBe("user-1");

    rememberUser("user-2" as UserId);
    expect(lastUserId()).toBe("user-2" as UserId);
  });

  it("ignores an empty id rather than blanking a good memo", async () => {
    const { lastUserId, rememberUser } = await import("../lastUser");
    rememberUser("user-1" as UserId);
    rememberUser("" as UserId);
    expect(lastUserId()).toBe("user-1" as UserId);
  });

  it("captures the id on sign-in, on every platform", async () => {
    const { lastUserId, registerLastUserMemo, resolveUserId } = await import("../lastUser");
    registerLastUserMemo();
    expect(lastUserId()).toBeNull();

    setSession({ status: "authed", user: { id: "abc" as UserId }, session: null });
    expect(lastUserId()).toBe("abc" as UserId);
    expect(resolveUserId()).toBe("abc" as UserId);

    // Signing out must NOT forget: an offline boot keeps the token but never
    // resolves an account payload, and the memo is what opens the library.
    setSession({ status: "anon", user: null, session: null });
    expect(lastUserId()).toBe("abc" as UserId);
    // resolveUserId is the LIVE question and correctly answers "nobody".
    expect(resolveUserId()).toBeNull();
  });

  it("falls back to session.user_id when the account payload is missing", async () => {
    const { lastUserId, registerLastUserMemo } = await import("../lastUser");
    registerLastUserMemo();
    setSession({ status: "authed", user: null, session: { user_id: "xyz" as UserId } });
    expect(lastUserId()).toBe("xyz" as UserId);
  });

  it("gives persistCache a non-null snapshot key after a sign-in", async () => {
    const { rememberUser } = await import("../lastUser");
    const { snapshotKeyForTests } = await import("@/api/persistCache");
    expect(snapshotKeyForTests()).toBeNull();
    rememberUser("user-9" as UserId);
    expect(snapshotKeyForTests()).toBe("oms-music.query-cache.user-9");
  });
});
