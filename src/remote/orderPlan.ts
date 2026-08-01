/**
 * `set_queue_order` executor planning (FR-109 command vocabulary), kept in
 * its own I/O-free module so it unit-tests in bun without dragging the
 * query client (and react-native with it) into the runner.
 *
 * The server sends a whole target order; the engine only exposes
 * `reorderQueue(from, to)`, whose cursor fixups are what keep the audible
 * song stable. Replaying the target as a sequence of single moves therefore
 * preserves every queue invariant instead of clobbering the quartet.
 */

/**
 * Plans the visible-index moves that turn `current` into `target`.
 * Returns null when `target` is not a permutation of `current` (a malformed
 * or racing order is ignored rather than half-applied).
 */
export const planOrderMoves = (
  current: readonly number[],
  target: readonly number[],
): { from: number; to: number }[] | null => {
  if (current.length !== target.length) return null;
  const work = [...current];
  const moves: { from: number; to: number }[] = [];
  for (let i = 0; i < target.length; i++) {
    const from = work.indexOf(target[i], i);
    if (from === -1) return null;
    if (from !== i) {
      const [value] = work.splice(from, 1);
      work.splice(i, 0, value);
      moves.push({ from, to: i });
    }
  }
  return moves;
};
