/**
 * 220 ms input debounce (FR-30). Local to the search feature; nothing else
 * in the app types while a query is in flight.
 */
import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 220;

export const useDebounced = <T,>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
};
