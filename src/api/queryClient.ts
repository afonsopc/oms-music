/**
 * The ONE QueryClient for the app lifetime (FR-6). Rebuilding it caused
 * refetch storms on the web that were mistaken for logout - never recreate.
 * staleTime 25s, retry off, no refetch-on-focus; onlineManager wired to
 * NetInfo, focusManager to AppState.
 */
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

import { ApiError } from "@/domain/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 25_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: false,
    },
  },
});

let wired = false;

/** Called once from the provider stack (theme/i18n providers mount first). */
export const wireQueryClient = (): void => {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) => {
    const subscription = NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected);
    });
    return subscription;
  });
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (status) => {
      handleFocus(status === "active");
    });
    return () => subscription.remove();
  });
};

// ---------------------------------------------------------------------------
// 429 parking (FR-5). parkQueryKey(key, untilMs) pauses the affected query:
// the shared query wrapper consults the park before hitting the network and
// re-throws the remembered error, so a 429 NEVER turns into a retry storm
// (each 429 pages the owner on Discord).
// ---------------------------------------------------------------------------

const parked = new Map<string, { until: number; error: ApiError }>();

const hashKey = (key: QueryKey): string => JSON.stringify(key);

export const parkQueryKey = (key: QueryKey, untilMs: number, error?: ApiError): void => {
  parked.set(hashKey(key), {
    until: untilMs,
    error: error ?? new ApiError(429, "Rate limited"),
  });
};

/** Returns the remembered error while the park is live, else null. */
export const getParkedError = (key: QueryKey): ApiError | null => {
  const entry = parked.get(hashKey(key));
  if (!entry) return null;
  if (Date.now() >= entry.until) {
    parked.delete(hashKey(key));
    return null;
  }
  return entry.error;
};
