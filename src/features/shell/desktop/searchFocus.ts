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

/**
 * Focus the topbar field if one is mounted; a silent no-op otherwise. Both
 * the Cmd/Ctrl+K shortcut and the sidebar's "Pesquisar" row land here, the
 * latter AFTER it has navigated: the field is the desktop's search input, but
 * focusing it is not by itself a substitute for going to the page (owner
 * report 2026-08-16, point 18).
 */
export const focusTopbarSearch = (): void => {
  focusFn?.();
};
