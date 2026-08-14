/**
 * Scroll offset -> row indices. Pure arithmetic, the same shape the deep-link
 * scroll in CollectionScreen already does (`headerHeight + index * rowHeight`),
 * run backwards.
 *
 * Deliberately NOT `onViewableItemsChanged`: threading a new callback through
 * SongTable would touch `renderItem`'s dep array and re-render every mounted
 * row, which is precisely the class of change the 2026-08-14 freeze report
 * exists to forbid. Fixed row height makes the arithmetic exact anyway, so
 * measurement buys nothing.
 */
import type { ViewportSignal } from "./types";

export interface ListGeometry {
  offsetY: number;
  headerHeight: number;
  rowHeight: number;
  viewportHeight: number;
  rowCount: number;
}

const UNKNOWN: ViewportSignal = { centerIndex: null, first: null, last: null };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const viewportIndices = (g: ListGeometry): ViewportSignal => {
  if (g.rowCount <= 0 || g.rowHeight <= 0) return UNKNOWN;
  const max = g.rowCount - 1;
  // `body` goes NEGATIVE while the hero is still on screen. The clamp sends
  // everything to row 0, which is exactly "opening a playlist targets its
  // first song" - the behaviour we want, for free, with no special case.
  const body = g.offsetY - g.headerHeight;
  return {
    first: clamp(Math.floor(body / g.rowHeight), 0, max),
    centerIndex: clamp(Math.floor((body + g.viewportHeight / 2) / g.rowHeight), 0, max),
    last: clamp(Math.floor((body + g.viewportHeight) / g.rowHeight), 0, max),
  };
};
