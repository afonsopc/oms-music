/**
 * Session service + zustand store (FR-7..11 service halves).
 * Boot: stored token -> GET /sessions/mine -> GET /users/:id behind splash;
 * 401 wipes and shows login; NETWORK FAILURE keeps the token and enters
 * authed-offline (the offline library still browses and plays, FR-91).
 *
 * `establishSession` below is the single funnel every sign-in method ends on.
 * Add a new method by obtaining a token and calling it; do not re-implement
 * the store writes, or the methods will drift apart.
 *
 * O único endpoint público do início de sessão (POST /sessions/adopt) vai
 * pelo `omsPublic()` em ./oauth: sem Bearer e sem acordar o guard num 401,
 * que ali é um bilhete expirado.
 */
import { create } from "zustand";
import { oms } from "@/api/oms";
import { queryClient } from "@/api/queryClient";
import { isApiError } from "@/domain/api";
import type { Session, User } from "@/domain/user";
import { isCookieAuth } from "./authMode";
import { clearToken, loadToken, setToken } from "./token";
import { onAuthLoss, setAuthReady } from "./guard";
import { adoptTicket } from "./oauth";

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

// Os tipos do SDK são o fio; os do domínio são o que os ecrãs lêem. Os casts
// de fronteira ficam nestes dois leitores.
const fetchMySession = (): Promise<Session> => oms().sessions.current() as Promise<Session>;
const fetchUser = (id: string): Promise<User> => oms().account.get(id) as Promise<User>;

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
  // A cookie origin never has a readable token, but may well have a live
  // httpOnly cookie (a sign-in on omelhorsite.pt is same-site with the API,
  // so it signs THIS origin in too): the only way to find out is to probe.
  // No cookie just means the probe 401s into the same anon path below.
  if (!token && !isCookieAuth()) {
    set({ status: "anon", session: null, user: null, offlineBoot: false });
    return;
  }
  try {
    const session = await fetchMySession();
    const user = await fetchUser(session.user_id);
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
  const session = await fetchMySession();
  const user = await fetchUser(session.user_id);
  set({ status: "authed", session, user, offlineBoot: false });
};

// ---------------------------------------------------------------------------
// Session establishment: the ONE path every sign-in method ends on
// ---------------------------------------------------------------------------

/**
 * Turns a freshly minted session token into a signed-in app.
 *
 * EVERY sign-in method must end here - today that is only id.omelhorsite.pt through
 * the OAuth ticket (POST /sessions/adopt) - so that token storage, query-cache
 * reset, cable reconnection and the route switch stay in one place. A future
 * method differs only in how it obtains the token.
 *
 * `seed` is the session object when the endpoint already returned one.
 * POST /sessions/adopt returns ONLY `{ token }`, so it passes nothing and this
 * reads GET /sessions/mine.
 *
 * Ordering is load-bearing:
 *  1. store the token first - every call below is authenticated, and the
 *     authenticated client refuses to send a request without one (on a cookie
 *     origin setToken deliberately stores nothing and the calls below ride
 *     the httpOnly cookie the sign-in response just set - see auth/token.ts);
 *  2. clear the query cache before flipping status, so no anonymous (or
 *     previous account's) data can be observed by the screens that mount next;
 *  3. flip the store and only THEN setAuthReady(true): the cable registrars
 *     require `status === "authed" && isAuthReady() && token` before they
 *     connect (social/register.ts:24-26), and both writes notify them.
 */
export const establishSession = async (
  token: string,
  seed?: Session | null,
): Promise<void> => {
  await setToken(token);
  queryClient.clear();
  const session = seed ?? (await fetchMySession());
  set({ status: "authed", session, user: session.user ?? null, offlineBoot: false });
  setAuthReady(true);
  // Refresh the full account for the conditional fields; best-effort, because
  // the embedded user from the session view already renders every screen.
  try {
    const user = await fetchUser(session.user_id);
    set({ user });
  } catch {
    // Keep the embedded user; the account refetches on the next reconnect.
  }
};

// ---------------------------------------------------------------------------
// Sign-in / logout
// ---------------------------------------------------------------------------

/**
 * OAuth (FR-12): exchange the intercepted callback ticket for a token, then
 * land authed through the shared path. The ticket lives 2 minutes and adopt
 * answers 401 "Invalid or expired ticket." past that; classifyAdoptError turns
 * it into an "it took too long, try again" message rather than a generic one.
 */
export const adoptOAuthTicket = async (ticket: string): Promise<void> => {
  const token = await adoptTicket(ticket);
  await establishSession(token);
};

/**
 * Logout (FR-10): DELETE /sessions/current best-effort (the server always
 * kills the calling session regardless of id; the SDK's signOut swallows a
 * 401/404 and falls back to /sessions/mine + DELETE /sessions/:id); the wipe
 * runs even on failure. SQLite files persist on disk namespaced per user id.
 */
export const logout = async (): Promise<void> => {
  try {
    await oms().sessions.signOut();
  } catch {
    // Wipe anyway.
  }
  await wipeToAnon();
};
