/**
 * Shared query-fn conventions (FR-5/FR-6):
 *  - 429 parking: the error is remembered and re-thrown until retry_after
 *    elapses, so refetches never turn into a retry storm;
 *  - 304 keep-previous: a surfaced 304 resolves with the query's previous
 *    data (react-query structural sharing keeps identity);
 *  - every authed hook gates on `enabled: authReady && ...`.
 *
 * Paginação (SDK): um `list()` devolve `Paginated<T>`. Onde a app precisa da
 * lista INTEIRA (álbum, artista, biblioteca, playlists, memberships) percorre-se
 * tudo com `collect(page, WHOLE_LIST_LIMIT)` a 500 por página - uma chamada no
 * caso normal, mais só quando há mesmo mais - e onde bastava uma página
 * pede-se `page`/`pageSize` explícitos e lê-se `.items`.
 */
import type { QueryKey } from "@tanstack/react-query";
import { getParkedError, parkQueryKey, queryClient } from "../queryClient";
import { isApiError } from "@/domain/api";

export const DEFAULT_PARK_SECONDS = 30;

/** Tecto do `collect()` nas listas inteiras: dez páginas de 500. */
export const WHOLE_LIST_LIMIT = 5_000;

/** A página cheia do servidor; a maior que ele aceita. */
export const FULL_PAGE = 500;

export const guardedQueryFn =
  <T>(key: QueryKey, fn: () => Promise<T>): (() => Promise<T>) =>
  async (): Promise<T> => {
    const parked = getParkedError(key);
    if (parked) throw parked;
    try {
      return await fn();
    } catch (error) {
      if (isApiError(error)) {
        if (error.status === 429) {
          const seconds = error.retryAfter ?? DEFAULT_PARK_SECONDS;
          parkQueryKey(key, Date.now() + seconds * 1000, error);
        }
        if (error.status === 304) {
          const previous = queryClient.getQueryData<T>(key);
          if (previous !== undefined) return previous;
        }
      }
      throw error;
    }
  };
