/**
 * Arranque optimista: quando é que a app pode entrar já com a conta da
 * última vez, e que a cópia guardada só vale se for coerente.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

const store = new Map<string, string>();
// A superfície inteira do kv: o mock.module do bun vale para o processo todo
// e os outros testes (lastUser) precisam de kvGet/kvSet.
mock.module("@/db/kv", () => ({
  kvGet: (key: string) => store.get(key) ?? null,
  kvSet: (key: string, value: string) => {
    store.set(key, value);
  },
  kvGetJson: (key: string) => {
    const raw = store.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  kvSetJson: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  },
  kvRemove: (key: string) => {
    store.delete(key);
  },
}));

const {
  canBootOptimistically,
  clearBootSnapshot,
  readBootSnapshot,
  writeBootSnapshot,
  BOOT_SNAPSHOT_KV_KEY,
} = await import("../bootSnapshot");

const music = (t: string) => t.startsWith("omsm_");
const session = { id: "s1", user_id: "u1" } as never;
const user = { id: "u1", name: "A" } as never;

beforeEach(() => store.clear());

describe("canBootOptimistically", () => {
  it("origem cookie: só depois da troca da sessão antiga", () => {
    expect(canBootOptimistically({ cookie: true, migrated: true, token: null, isMusicToken: music })).toBe(true);
    expect(canBootOptimistically({ cookie: true, migrated: false, token: null, isMusicToken: music })).toBe(false);
  });
  it("nativo: só com um token da música", () => {
    expect(canBootOptimistically({ cookie: false, migrated: false, token: "omsm_x", isMusicToken: music })).toBe(true);
    expect(canBootOptimistically({ cookie: false, migrated: false, token: "antigo", isMusicToken: music })).toBe(false);
    expect(canBootOptimistically({ cookie: false, migrated: true, token: null, isMusicToken: music })).toBe(false);
  });
});

describe("snapshot", () => {
  it("guarda e lê", () => {
    writeBootSnapshot(session, user);
    expect(readBootSnapshot()).toEqual({ session, user });
  });
  it("recusa sessão de outra conta", () => {
    writeBootSnapshot({ id: "s1", user_id: "u2" } as never, user);
    expect(readBootSnapshot()).toBeNull();
  });
  it("ignora lixo no disco", () => {
    store.set(BOOT_SNAPSHOT_KV_KEY, JSON.stringify({ user: {} }));
    expect(readBootSnapshot()).toBeNull();
  });
  it("sair apaga", () => {
    writeBootSnapshot(session, user);
    clearBootSnapshot();
    expect(readBootSnapshot()).toBeNull();
  });
});
