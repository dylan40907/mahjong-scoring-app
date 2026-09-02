/**
 * Moving one tile within the row.
 *
 * Reordering is a real need rather than a nicety: the detector reads left to
 * right, and a hand photographed from the far side of the table comes back
 * reversed, which no amount of per-tile correction fixes.
 *
 * Generic because the same move has to be applied twice - once to the tiles
 * and once to the parallel flags saying which of them were melded - and the
 * two must never be allowed to disagree about where a tile went.
 */
export function moveTile<T>(tiles: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= tiles.length) return [...tiles];
  const next = [...tiles];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
