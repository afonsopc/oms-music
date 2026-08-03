/**
 * Session service + zustand store (FR-7..11 service halves).
 * Boot: stored token -> GET /sessions/mine -> GET /users/:id behind splash;
 * 401 wipes and shows login; NETWORK FAILURE keeps the token and enters
 * authed-offline (the offline library still browses and plays, FR-91).
 *
 * `establishSession` below is the single funnel every sign-in method ends on.
 * Add a new method by obtaining a token and calling it; do not re-implement
 * the store writes, or the methods will drift apart.
 */
import { create } from "zustand";
import { request } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { isApiError } from "@/domain/api";
import type { Session, User } from "@/domain/user";
import { clearToken, loadToken, setToken } from "./token";
import { onAuthLoss, setAuthReady } from "./guard";
import { MissingCredentialsError } from "./authErrors";
import { adoptTicket } from "./oauth";
import { assertPasskey } from "./passkeys";

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
// Session establishment: the ONE path every sign-in method ends on
// ---------------------------------------------------------------------------

/**
 * Turns a freshly minted session token into a signed-in app.
 *
 * EVERY sign-in method must end here - password (POST /sessions), OAuth
 * (POST /sessions/adopt) and passkey (POST /webauthn_credentials/
 * authentication) - so that token storage, query-cache reset, cable
 * reconnection and the route switch are byte-identical no matter how the user
 * signed in. The methods differ only in how they obtain the token.
 *
 * `seed` is the session object when the endpoint already returned one:
 * POST /sessions and the passkey assertion both answer with the full
 * SessionBlueprint `:token` view (Blueprinter views inherit the base fields),
 * so re-fetching would be a wasted round trip. POST /sessions/adopt returns
 * ONLY `{ token }`, so it passes nothing and this reads GET /sessions/mine.
 *
 * Ordering is load-bearing:
 *  1. store the token first - every call below is authenticated, and the HTTP
 *     client refuses to send an authed request without one;
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
  const session = seed ?? (await request<Session>("GET", "/sessions/mine"));
  set({ status: "authed", session, user: session.user ?? null, offlineBoot: false });
  setAuthReady(true);
  // Refresh the full account for the conditional fields; best-effort, because
  // the embedded user from the session view already renders every screen.
  try {
    const user = await request<User>("GET", `/users/${session.user_id}`);
    set({ user });
  } catch {
    // Keep the embedded user; the account refetches on the next reconnect.
  }
};

// ---------------------------------------------------------------------------
// Login / signup / reset / logout
// ---------------------------------------------------------------------------

/**
 * POST /sessions -> establishSession. Throws:
 *  - MissingCredentialsError when either field is empty. The server has no
 *    401 for that: `User.authenticate_by` raises ArgumentError when the body
 *    carries no `password` key at all, which escapes as a 500 AND fires a
 *    Discord error alert, so the request is refused locally instead;
 *  - ApiError 401 (wrong credentials), 422 (the account is DEACTIVATED, with
 *    an empty body) or 429 (10/min per IP). classifyLoginError explains each.
 */
export const login = async (email: string, password: string): Promise<void> => {
  const normalisedEmail = email.trim();
  if (!normalisedEmail || !password) throw new MissingCredentialsError();
  const session = await request<Session>("POST", "/sessions", {
    body: { email: normalisedEmail, password },
    auth: false,
  });
  if (!session.token) throw new Error("Login response missing token");
  await establishSession(session.token, session);
};

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
 * Passkey (FR-13): the discoverable-credential ceremony, then the same shared
 * path. No email is collected first - `allowCredentials` comes back empty
 * (`webauthn_credentials_controller.rb:63-69`) and the authenticator picks the
 * account, so this needs nothing from the login form.
 *
 * The assertion answers 201 with the full SessionBlueprint `:token` view, the
 * same shape as POST /sessions, so the session is seeded and `/sessions/mine`
 * is not re-fetched.
 *
 * Throws PasskeyCeremonyError for anything the platform raised (including a
 * plain cancellation) and ApiError for the endpoints; `classifyPasskeyFailure`
 * tells them apart.
 */
export const loginWithPasskey = async (): Promise<void> => {
  const session = await assertPasskey();
  if (!session.token) throw new Error("Passkey login response missing token");
  await establishSession(session.token, session);
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
