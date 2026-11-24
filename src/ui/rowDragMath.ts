/** Ramp of the step with which a neighbour makes room: it slides, it does not jump. */
const SLIDE_PX = 10;

/**
 * Vertical offset of row `index` while row `from` is dragged by `travel`. The
 * dragged row follows the finger; a neighbour moves one row over exactly where
 * the drop target changes (half a row), so what is seen is where it lands.
 */
export function rowDragOffset(index: number, from: number, travel: number, rowHeight: number): number {
  "worklet";
  if (from < 0) return 0;
  if (index === from) return travel;
  const below = index > from;
  const step = (index - from + (below ? -0.5 : 0.5)) * rowHeight;
  const raw = (travel - (step - SLIDE_PX)) / (2 * SLIDE_PX);
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return below ? -rowHeight * t : rowHeight * (1 - t);
}
