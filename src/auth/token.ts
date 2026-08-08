/**
 * Session token store: SecureStore is the durable copy, an in-memory mirror
 * serves synchronous reads (the HTTP client and media URL builders need the
 * token without awaiting).
 *
 * On web expo-secure-store is an EMPTY module (every call throws), which made
 * each page refresh land on the login screen. The durable copy there is
 * localStorage - the same place the web client proper keeps its token.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

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
  try {
    mirror = await store.getItemAsync(TOKEN_KEY);
  } catch {
    mirror = null;
  }
  loaded = true;
  return mirror;
};

export const setToken = async (token: string): Promise<void> => {
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
