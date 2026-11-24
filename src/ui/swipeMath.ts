export const SWIPE_ACTION_WIDTH = 92;
const FLING = 500;

/** Letting go of a swiped row: does the action stay uncovered? */
export function swipeSettles(x: number, velocityX: number): boolean {
  "worklet";
  if (velocityX < -FLING) return x < -8;
  if (velocityX > FLING) return false;
  return x < -SWIPE_ACTION_WIDTH / 2;
}
