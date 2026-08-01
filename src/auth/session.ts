/**
 * Session service + zustand store (FR-7..11 service halves).
 * Boot: stored token -> GET /sessions/mine -> GET /users/:id behind splash;
 * 401 wipes and shows login; NETWORK FAILURE keeps the token and enters
 * authed-offline (the offline library still browses and plays, FR-91).
 */
import { create } from "zustand";
import { request } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { isApiError } from "@/domain/api";
import type { Session, User } from "@/domain/user";
import { clearToken, loadToken, setToken } from "./token";
import { onAuthLoss, setAuthReady } from "./guard";

export type SessionStatus = "booting" | "anon" | "authed";

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  user: User | null;
  /** True when boot kept the token but could not reach the backend. */
  offlineBoot: boolean;
}

export const useSessionStore = create<SessionState>(() => ({
  status: "booting",
  session: null,
  user: null,
  offlineBoot: false,
}));

const set = useSessionStore.setState;

// ---------------------------------------------------------------------------
// Logout tasks: subsystems (cable, download scheduler, stores) register a
// wipe callback; logout and auth loss run every one even when the network
// call fails.
// ---------------------------------------------------------------------------
const logoutTasks = new Set<() => void>();
export const registerLogoutTask = (task: () => void): (() => void) => {
  logoutTasks.add(task);
  return () => logoutTasks.delete(task);
};

const runLogoutTasks = (): void => {
  for (const task of logoutTasks) {
    try {
      task();
    } catch {
      // A wipe task must never block the others.
    }
  }
};

const wipeToAnon = async (): Promise<void> => {
  setAuthReady(false);
  await clearToken();
  runLogoutTasks();
  queryClient.clear();
  set({ status: "anon", session: null, user: null, offlineBoot: false });
};

// Auth loss detected by the guard's probe: same wipe path.
onAuthLoss(() => {
  void wipeToAnon();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
export const bootSession = async (): Promise<void> => {
  set({ status: "booting" });
  const token = await loadToken();
  if (!token) {
    set({ status: "anon", session: null, user: null, offlineBoot: false });
    return;
  }
  try {
    const session = await request<Session>("GET", "/sessions/mine");
    const user = await request<User>("GET", `/users/${session.user_id}`);
    set({ status: "authed", session, user, offlineBoot: false });
    setAuthReady(true);
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      await wipeToAnon();
      return;
    }
    // Network failure: keep the token, enter authed-offline. The offline
    // library still works; queries stay parked until connectivity returns.
    set({ status: "authed", session: null, user: null, offlineBoot: true });
    setAuthReady(true);
  }
};

/** Re-runs the /sessions/mine + /users/:id pair (e.g. after reconnect). */
export const refreshAccount = async (): Promise<void> => {
  const session = await request<Session>("GET", "/sessions/mine");
  const user = await request<User>("GET", `/users/${session.user_id}`);
  set({ status: "authed", session, user, offlineBoot: false });
};

// ---------------------------------------------------------------------------
// Login / signup / reset / logout
// ---------------------------------------------------------------------------

/** POST /sessions; stores the token; lands authed. Throws ApiError on 401/429. */
export const login = async (email: string, password: string): Promise<void> => {
  const session = await request<Session>("POST", "/sessions", {
    body: { email, password },
    auth: false,
  });
  if (!session.token) throw new Error("Login response missing token");
  await setToken(session.token);
  set({ status: "authed", session, user: session.user ?? null, offlineBoot: false });
  setAuthReady(true);
  // Refresh the full account for the conditional fields; best-effort.
  try {
    const user = await request<User>("GET", `/users/${session.user_id}`);
    set({ user });
  } catch {
    // The embedded user from the token view is enough to render.
  }
};

/** Signup step 1: sends the 6-digit code. 409 = "Email already registered." */
export const signupStart = (email: string): Promise<string> =>
  request<string>("POST", "/users/create_start", { body: { email }, auth: false });

/**
 * Signup step 2: verifies the code and creates the account. Does NOT log in;
 * callers follow with login(email, password) (FR-8).
 */
export const signupEnd = (
  email: string,
  code: string,
  name: string,
  password: string,
): Promise<User> =>
  request<User>("POST", "/users/create_end", {
    body: { email, code, name, password },
    auth: false,
  });

/** Always 200 (anti-enumeration). */
export const resetPasswordStart = (email: string): Promise<unknown> =>
  request("POST", "/users/reset_password_start", { body: { email }, auth: false });

export const resetPasswordEnd = (
  email: string,
  code: string,
  password: string,
): Promise<unknown> =>
  request("POST", "/users/reset_password_end", {
    body: { email, code, password },
    auth: false,
  });

/**
 * Logout (FR-10): DELETE /sessions/current best-effort (the server always
 * kills the calling session regardless of id); the wipe runs even on failure.
 * SQLite files persist on disk namespaced per user id.
 */
export const logout = async (): Promise<void> => {
  try {
    await request("DELETE", "/sessions/current");
  } catch {
    // Wipe anyway.
  }
  await wipeToAnon();
};
