/**
 * View-mode vocabularies (plano-uma-so-app 4.3 + 4.5). Pure and bun-tested
 * like breakpoints.ts: the DESKTOP shell persists these strings in kv, and
 * localStorage survives deploys that rename enums - so every reader
 * validates through the guards here and falls back to the default instead
 * of trusting whatever string an old build left behind.
 *
 * Two vocabularies on purpose:
 *  - a COLLECTION (track list) can be a list or a compact list; a grid of
 *    songs is not a thing this app does.
 *  - the LIBRARY (collections of collections) additionally earns a grid,
 *    the natural shape for artwork-led browsing.
 */

export const COLLECTION_VIEW_MODES = ["list", "compact"] as const;
export type CollectionViewMode = (typeof COLLECTION_VIEW_MODES)[number];

export const DEFAULT_COLLECTION_VIEW_MODE: CollectionViewMode = "list";

export const isCollectionViewMode = (value: unknown): value is CollectionViewMode =>
  value === "list" || value === "compact";

export const LIBRARY_VIEW_MODES = ["list", "compact", "grid"] as const;
export type LibraryViewMode = (typeof LIBRARY_VIEW_MODES)[number];

export const DEFAULT_LIBRARY_VIEW_MODE: LibraryViewMode = "list";

export const isLibraryViewMode = (value: unknown): value is LibraryViewMode =>
  value === "list" || value === "compact" || value === "grid";
