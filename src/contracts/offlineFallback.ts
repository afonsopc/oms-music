/**
 * Offline fallback seam (DESIGN.md 13.2). WP1 wraps the relevant query fns
 * with `withOfflineFallback` up front; WP8 registers the resolvers derived
 * from the downloaded library plus the `isOfflineNow` provider. Until then
 * the wrappers are inert pass-throughs.
 */

export type OfflineFallbackKey =
  | "songs"
  | "albums"
  | "artists"
  | "playlists"
  | "liked"
  | "lyrics";

type Resolver = (...args: unknown[]) => Promise<unknown>;

const resolvers = new Map<OfflineFallbackKey, Resolver>();

let offlineNowProvider: () => boolean = () => false;

/** WP8 registers a resolver producing offline data for the given key. */
export const registerOfflineResolver = <A extends unknown[], R>(
  key: OfflineFallbackKey,
  resolver: (...args: A) => Promise<R>,
): void => {
  resolvers.set(key, resolver as Resolver);
};

/** WP8 wires this to NetInfo; default: never offline. */
export const setOfflineNowProvider = (provider: () => boolean): void => {
  offlineNowProvider = provider;
};

export const isOfflineNow = (): boolean => offlineNowProvider();

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof Error && /network|fetch|abort|timeout/i.test(error.message));

/**
 * Wraps a query fn so that, when a resolver is registered for `key`, the app
 * skips doomed network calls while offline and falls back to the offline
 * resolver on network failure. Without a registered resolver the primary fn
 * runs untouched (inert default).
 */
export const withOfflineFallback = <A extends unknown[], R>(
  primary: (...args: A) => Promise<R>,
  key: OfflineFallbackKey,
): ((...args: A) => Promise<R>) => {
  return async (...args: A): Promise<R> => {
    const resolver = resolvers.get(key);
    if (resolver && isOfflineNow()) {
      return (await resolver(...args)) as R;
    }
    try {
      return await primary(...args);
    } catch (error) {
      if (resolver && isNetworkFailure(error)) {
        return (await resolver(...args)) as R;
      }
      throw error;
    }
  };
};
