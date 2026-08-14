/**
 * Desktop layout persistence (plano-uma-so-app 4.5): the difference between
 * a desktop app and a stretched phone app is that the layout REMEMBERS.
 * Everything here rides on `kv` (localStorage on web), read synchronously at
 * mount so the shell renders in its remembered shape on the first frame -
 * no collapsed-then-expanding sidebar flicker after a reload.
 *
 * Keys are additive and self-contained: an unknown or corrupt value falls
 * back to the default, never to a crash, because localStorage survives
 * deploys that rename enums.
 */
import { kvGet, kvGetJson, kvSet, kvSetJson } from "@/db/kv";
import type { LibraryFilter } from "@/features/library/rows";
import {
  DEFAULT_COLLECTION_VIEW_MODE,
  DEFAULT_LIBRARY_VIEW_MODE,
  isCollectionViewMode,
  isLibraryViewMode,
  type CollectionViewMode,
  type LibraryViewMode,
} from "@/ui/viewModes";
import {
  clampSidebarWidth,
  DEFAULT_TIME_LABEL_MODE,
  isTimeLabelMode,
  recordViewMode,
  type TimeLabelMode,
} from "./layoutModel";
import {
  isRightPanelTenant,
  parseRightPanelWidth,
  RIGHT_PANEL_DEFAULT_TENANT,
  type RightPanelTenant,
} from "./rightPanelModel";

const SIDEBAR_COLLAPSED_KEY = "oms-music.desktop.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "oms-music.desktop.sidebar.width";
const SIDEBAR_FILTER_KEY = "oms-music.desktop.sidebar.filter";
const SIDEBAR_SEARCH_KEY = "oms-music.desktop.sidebar.search";
const RIGHT_PANEL_OPEN_KEY = "oms-music.desktop.rightPanel.open";
const RIGHT_PANEL_TENANT_KEY = "oms-music.desktop.rightPanel.tenant";
const RIGHT_PANEL_WIDTH_KEY = "oms-music.desktop.rightPanel.width";
const COLLECTION_VIEW_MODES_KEY = "oms-music.desktop.viewModes.collections";
const LIBRARY_VIEW_MODE_KEY = "oms-music.desktop.viewModes.library";
const TIME_LABEL_KEY = "oms-music.desktop.transport.timeLabel";

export const readSidebarCollapsed = (): boolean => kvGet(SIDEBAR_COLLAPSED_KEY) === "1";

export const writeSidebarCollapsed = (collapsed: boolean): void => {
  kvSet(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
};

/** Wanted sidebar width in px, clamped on read AND write (layoutModel). */
export const readSidebarWidth = (): number => {
  const stored = kvGet(SIDEBAR_WIDTH_KEY);
  return clampSidebarWidth(stored == null ? Number.NaN : Number(stored));
};

export const writeSidebarWidth = (width: number): void => {
  kvSet(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
};

const isLibraryFilter = (value: string | null): value is LibraryFilter =>
  value === "all" || value === "playlists" || value === "artists" || value === "albums";

/** Same default the Library tab uses: "all" walks every row, so playlists. */
export const readSidebarFilter = (): LibraryFilter => {
  const stored = kvGet(SIDEBAR_FILTER_KEY);
  return isLibraryFilter(stored) ? stored : "playlists";
};

export const writeSidebarFilter = (filter: LibraryFilter): void => {
  kvSet(SIDEBAR_FILTER_KEY, filter);
};

export const readSidebarSearch = (): string => kvGet(SIDEBAR_SEARCH_KEY) ?? "";

export const writeSidebarSearch = (search: string): void => {
  kvSet(SIDEBAR_SEARCH_KEY, search);
};

/** The right panel defaults to open where it fits: it is the point of 1200px. */
export const readRightPanelOpen = (): boolean => kvGet(RIGHT_PANEL_OPEN_KEY) !== "0";

export const writeRightPanelOpen = (open: boolean): void => {
  kvSet(RIGHT_PANEL_OPEN_KEY, open ? "1" : "0");
};

/** ONE key for the five tenants (4.3): an unknown value is Now Playing. */
export const readRightPanelTenant = (): RightPanelTenant => {
  const stored = kvGet(RIGHT_PANEL_TENANT_KEY);
  return isRightPanelTenant(stored) ? stored : RIGHT_PANEL_DEFAULT_TENANT;
};

export const writeRightPanelTenant = (tenant: RightPanelTenant): void => {
  kvSet(RIGHT_PANEL_TENANT_KEY, tenant);
};

/**
 * Wanted panel width in px (4.5). Absolute bounds are applied on read; the
 * window-dependent ceiling is the shell's render-time concern (the window a
 * width was saved under is not the window it wakes up under).
 */
export const readRightPanelWidth = (): number => parseRightPanelWidth(kvGet(RIGHT_PANEL_WIDTH_KEY));

export const writeRightPanelWidth = (width: number): void => {
  kvSet(RIGHT_PANEL_WIDTH_KEY, String(Math.round(width)));
};

/**
 * Per-collection view mode (4.3 collection row): ONE json map under one
 * key, recency-ordered and capped by layoutModel.recordViewMode - never a
 * kv key per collection, or localStorage grows without bound and without
 * an enumeration path.
 */
const readCollectionViewModes = (): Record<string, CollectionViewMode> => {
  const raw = kvGetJson<Record<string, unknown>>(COLLECTION_VIEW_MODES_KEY);
  if (raw == null || typeof raw !== "object") return {};
  const valid: Record<string, CollectionViewMode> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isCollectionViewMode(value)) valid[key] = value;
  }
  return valid;
};

export const readCollectionViewMode = (collectionKey: string): CollectionViewMode =>
  readCollectionViewModes()[collectionKey] ?? DEFAULT_COLLECTION_VIEW_MODE;

export const writeCollectionViewMode = (
  collectionKey: string,
  mode: CollectionViewMode,
): void => {
  kvSetJson(
    COLLECTION_VIEW_MODES_KEY,
    recordViewMode(readCollectionViewModes(), collectionKey, mode),
  );
};

/** Library main-view mode (4.3 library row): list / compact / grid. */
export const readLibraryViewMode = (): LibraryViewMode => {
  const stored = kvGet(LIBRARY_VIEW_MODE_KEY);
  return isLibraryViewMode(stored) ? stored : DEFAULT_LIBRARY_VIEW_MODE;
};

export const writeLibraryViewMode = (mode: LibraryViewMode): void => {
  kvSet(LIBRARY_VIEW_MODE_KEY, mode);
};

/** Transport time label (4.3 transport row): elapsed or remaining. */
export const readTimeLabelMode = (): TimeLabelMode => {
  const stored = kvGet(TIME_LABEL_KEY);
  return isTimeLabelMode(stored) ? stored : DEFAULT_TIME_LABEL_MODE;
};

export const writeTimeLabelMode = (mode: TimeLabelMode): void => {
  kvSet(TIME_LABEL_KEY, mode);
};
