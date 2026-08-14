/**
 * 401/fs-404 verification + the global authReady gate (DESIGN.md 5.5).
 *
 * Any 401 from an authed endpoint, and any /media 404 while believed-authed
 * (the media routes answer 404, never 401, so a dead token looks like a
 * missing file), runs ONE single-flight `GET /sessions/mine` probe:
 *  - probe succeeds -> transient / genuinely missing file, resume;
 *  - probe 401s -> flip authReady = false FIRST (parks queries, stops the
 *    cable, pauses download enqueues, silences the publisher), then the
 *    session layer wipes token + caches and shows login.
 * No caller ever retries on its own.
 */
import { useSyncExternalStore } from "react";
import { request, setAuthFailureHandler } from "@/api/client";
import { isApiError } from "@/domain/api";
import type { Session } from "@/domain/user";
import { getToken } from "./token";

let authReady = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const cb of listeners) cb();
};

export const isAuthReady = (): boolean => authReady;

export const setAuthReady = (value: boolean): void => {
  if (authReady === value) return;
  authReady = value;
  notify();
};

export const subscribeAuthReady = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Reactive read for query `enabled` gates. */
export const useAuthReady = (): boolean =>
  useSyncExternalStore(subscribeAuthReady, isAuthReady, isAuthReady);

/** Registered by auth/session.ts: performs the wipe + navigation to login. */
type AuthLossHandler = () => void;
let authLossHandler: AuthLossHandler = () => {};
export const onAuthLoss = (handler: AuthLossHandler): void => {
  authLossHandler = handler;
};

let inflight: Promise<boolean> | null = null;

/**
 * Single-flight probe. Resolves true when the session is still valid.
 * On a definitive 401 it flips authReady false and hands off to the session
 * layer. Network failures resolve true (transient; keep the token).
 */
export const verify = (): Promise<boolean> => {
  if (inflight) return inflight;
  if (!getToken()) {
    setAuthReady(false);
    return Promise.resolve(false);
  }
  inflight = (async () => {
    try {
      await request<Session>("GET", "/sessions/mine");
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setAuthReady(false); // FIRST: parks everything
        authLossHandler(); // then: wipe + show login
        return false;
      }
      // Transient (network, 5xx): keep the session; callers resume.
      return true;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

// The client notifies us on auth-shaped failures; fire-and-forget.
setAuthFailureHandler(() => {
  void verify();
});
