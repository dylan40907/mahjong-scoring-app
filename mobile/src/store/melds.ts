import type { TileCode } from '@/tiles/tileset';

/**
 * Turning "these tiles were exposed" into groups the scorer understands.
 *
 * Which tiles are melded cannot be recovered from a photograph. Spacing is the
 * only clue and it is often absent - a player who pushes their hand together
 * before you photograph it has destroyed the evidence, and the old heuristic
 * then reported melds that were never declared. Guessing wrong is worse than
 * not guessing: an exposed hand scores differently from a concealed one under
 * every ruleset here.
 *
 * So the player says. Everything starts concealed, they mark the runs they
 * melded, and this converts that into the group shape `buildHandInput` reads.
 * A span is contiguous in reading order because a declared meld is physically
 * set down together.
 */

/** Inclusive tile-index range, in the order the hand is displayed. */
export type Span = readonly [number, number];

export interface Grouping {
  groups: TileCode[][];
  /** Indices into `groups` that are exposed melds. */
  meldGroups: number[];
}

/** Normalise, drop empties, sort, and merge anything overlapping or touching. */
export function normaliseSpans(spans: readonly Span[], tileCount: number): Span[] {
  const clamped = spans
    .map(([a, b]): Span => [Math.max(0, Math.min(a, b)), Math.min(tileCount - 1, Math.max(a, b))])
    .filter(([a, b]) => a <= b && a < tileCount && b >= 0)
    .sort((left, right) => left[0] - right[0]);

  const merged: Span[] = [];
  for (const span of clamped) {
    const last = merged[merged.length - 1];
    // Adjacent spans merge too: two melds declared side by side with no tile
    // between them cannot be told apart later, so treating them as one run and
    // letting the size check reject it is more honest than silently splitting.
    if (last && span[0] <= last[1] + 1) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], span[1])];
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * Split a flat hand into groups, with the marked spans as exposed melds and
 * everything between them concealed.
 */
export function applyExposedSpans(
  tiles: readonly TileCode[],
  spans: readonly Span[],
): Grouping {
  const ranges = normaliseSpans(spans, tiles.length);
  const groups: TileCode[][] = [];
  const meldGroups: number[] = [];

  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) groups.push(tiles.slice(cursor, start));
    groups.push(tiles.slice(start, end + 1));
    meldGroups.push(groups.length - 1);
    cursor = end + 1;
  }
  if (cursor < tiles.length) groups.push(tiles.slice(cursor));

  // A hand with no melds is still one group, so the review screen always has
  // something to render.
  if (groups.length === 0) groups.push([]);
  return { groups, meldGroups };
}

/** The spans currently marked exposed, in flat tile indices. */
export function spansFromGrouping(grouping: Grouping): Span[] {
  const spans: Span[] = [];
  let offset = 0;
  grouping.groups.forEach((group, index) => {
    if (grouping.meldGroups.includes(index) && group.length > 0) {
      spans.push([offset, offset + group.length - 1]);
    }
    offset += group.length;
  });
  return spans;
}

/** Every tile index covered by an exposed span. */
export function exposedIndices(spans: readonly Span[]): Set<number> {
  const set = new Set<number>();
  for (const [start, end] of spans) {
    for (let i = start; i <= end; i += 1) set.add(i);
  }
  return set;
}

/**
 * Move one tile to another position, keeping the rest in order.
 *
 * Reordering is a real need rather than a nicety: the detector reads left to
 * right, and a hand photographed from the far side of the table comes back
 * reversed, which no amount of per-tile correction fixes.
 */
export function moveTile<T>(tiles: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= tiles.length) return [...tiles];
  const next = [...tiles];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
