/**
 * Topbar-search focus registry (plano-uma-so-app 4.4, Cmd/Ctrl+K): the
 * shortcut handler and the search field live in different subtrees of the
 * shell, so the field registers an imperative focus function here instead
 * of the two threading refs through the grid. Same one-slot pattern as the
 * shell slots module; unregistered, the shortcut is a silent no-op.
 */
let focusFn: (() => void) | null = null;

export const registerTopbarSearchFocus = (fn: (() => void) | null): void => {
  focusFn = fn;
};

export const focusTopbarSearch = (): void => {
  focusFn?.();
};

/**
 * The sidebar rail's "Pesquisar" entry point: on the desktop shell a second
 * full-page search input is redundant with the persistent topbar field, so
 * activating search FOCUSES the topbar (same landing as Cmd/Ctrl+K) instead
 * of navigating. The fallback runs only while no field is registered -
 * i.e. outside the desktop shell - keeping the mobile navigation intact.
 */
export const focusTopbarSearchOrNavigate = (navigate: () => void): void => {
  if (focusFn) {
    focusFn();
    return;
  }
  navigate();
};
