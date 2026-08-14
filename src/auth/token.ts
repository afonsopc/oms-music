/**
 * Session token store: SecureStore is the durable copy, an in-memory mirror
 * serves synchronous reads (the HTTP client and media URL builders need the
 * token without awaiting).
 *
 * On web expo-secure-store is an EMPTY module (every call throws), which made
 * each page refresh land on the login screen. The durable copy there is
 * localStorage - the same place the web client proper keeps its token.
 *
 * On a COOKIE ORIGIN (music.omelhorsite.pt, see auth/authMode.ts) this store
 * deliberately holds nothing: the credential is the httpOnly cookie, which JS
 * can neither read nor mirror. The sign-in endpoints still return the token
 * in the body for native/dev clients, but storing it here would put a Bearer
 * credential back in XSS-readable storage AND recreate the site's
 * purgeLegacyToken lockout - the API reads header/param before the cookie,
 * so a long-dead stored token shadows a perfectly fresh cookie and answers
 * 401 to everything.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { isCookieAuth } from "./authMode";

const TOKEN_KEY = "oms-music.session-token";

const webStore = {
  getItemAsync: async (key: string): Promise<string | null> => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItemAsync: async (key: string, value: string): Promise<void> => {
    window.localStorage.setItem(key, value);
  },
  deleteItemAsync: async (key: string): Promise<void> => {
    window.localStorage.removeItem(key);
  },
};

const store = Platform.OS === "web" ? webStore : SecureStore;

let mirror: string | null = null;
let loaded = false;

/** Synchronous read from the mirror. Null until loadToken() ran at boot. */
export const getToken = (): string | null => mirror;

export const hasLoadedToken = (): boolean => loaded;

/** Boot: pull the token from SecureStore into the mirror. */
export const loadToken = async (): Promise<string | null> => {
  if (isCookieAuth()) {
    // Never read a stored token on a cookie origin - and actively purge any
    // leftover one (a sign-in from before this origin switched to cookies),
    // for the shadowing reason in the header comment.
    mirror = null;
    loaded = true;
    try {
      await store.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Best-effort; nothing reads it on this origin anyway.
    }
    return null;
  }
  try {
    mirror = await store.getItemAsync(TOKEN_KEY);
  } catch {
    mirror = null;
  }
  loaded = true;
  return mirror;
};

export const setToken = async (token: string): Promise<void> => {
  if (isCookieAuth()) {
    // Drop the body token: the Set-Cookie on the very same sign-in response
    // is the credential here (see the header comment).
    mirror = null;
    loaded = true;
    return;
  }
  mirror = token;
  loaded = true;
  try {
    await store.setItemAsync(TOKEN_KEY, token);
  } catch {
    // The mirror still works for this launch; next boot re-authenticates.
  }
};

export const clearToken = async (): Promise<void> => {
  mirror = null;
  try {
    await store.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Best-effort; the mirror is already empty.
  }
};

/**
 * The credential the cable handshake rides on: the Bearer token where one
 * exists, or "" on a cookie origin - the /cable handshake is a same-site GET,
 * so the browser attaches the httpOnly session cookie by itself and the
 * server accepts it as the last candidate after param and header
 * (connection.rb / Session.candidate_tokens). null means no credential at
 * all: the registrars stay disconnected.
 */
export const cableCredential = (): string | null => {
  if (mirror) return mirror;
  return isCookieAuth() ? "" : null;
};
