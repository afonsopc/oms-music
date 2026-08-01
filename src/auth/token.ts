/**
 * Session token store: SecureStore is the durable copy, an in-memory mirror
 * serves synchronous reads (the HTTP client and media URL builders need the
 * token without awaiting).
 */
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "oms-music.session-token";

let mirror: string | null = null;
let loaded = false;

/** Synchronous read from the mirror. Null until loadToken() ran at boot. */
export const getToken = (): string | null => mirror;

export const hasLoadedToken = (): boolean => loaded;

/** Boot: pull the token from SecureStore into the mirror. */
export const loadToken = async (): Promise<string | null> => {
  try {
    mirror = await SecureStore.getItemAsync(TOKEN_KEY);
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
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // The mirror still works for this launch; next boot re-authenticates.
  }
};

export const clearToken = async (): Promise<void> => {
  mirror = null;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Best-effort; the mirror is already empty.
  }
};
