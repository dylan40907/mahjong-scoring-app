import type { TileCode } from '@/tiles/tileset';

/**
 * Turning "these tiles were declared" into groups the scorer understands.
 *
 * Which tiles are melded cannot be recovered from a photograph. Spacing is the
 * only clue and it is often absent - a player who pushes their hand together
 * before you photograph it has destroyed the evidence, and the old heuristic
 * then reported melds that were never declared. Guessing wrong is worse than
 * not guessing: an exposed hand scores differently from a concealed one under
 * every ruleset here.
 *
 * So the player says. Everything starts concealed and unclaimed, they mark the
 * runs they declared, and this converts that into the group shape
 * `buildHandInput` reads. A mark is contiguous in reading order because a
 * declared meld is physically set down together.
 *
 * A declaration carries whether it was concealed, which is not a detail. A
 * concealed kong is set down like any other meld and is still part of a
 * concealed hand: in Riichi it leaves riichi, menzen tsumo and pinfu intact
 * and is worth double the fu of a melded one, and Taiwanese and MCR both pay
 * it more. Treating every declaration as exposed - which this used to do -
 * quietly deleted all of that.
 */

/** Inclusive tile-index range, in the order the hand is displayed. */
export interface DeclaredMeld {
  readonly start: number;
  readonly end: number;
  /**
   * Declared from four tiles held in hand: set down, but never shown.
   *
   * Only a kong can be both declared and concealed. A concealed run or triplet
   * is simply still in the hand, and the decomposer finds those on its own.
   */
  readonly concealed: boolean;
}

export interface Grouping {
  groups: TileCode[][];
  /** Indices into `groups` that are declared melds. */
  meldGroups: number[];
  /** The subset of `meldGroups` that were declared concealed. */
  concealedMelds: number[];
}

/** Normalise, drop empties, sort, and merge anything overlapping or touching. */
export function normaliseMelds(melds: readonly DeclaredMeld[], tileCount: number): DeclaredMeld[] {
  const clamped = melds
    .map((meld) => ({
      start: Math.max(0, Math.min(meld.start, meld.end)),
      end: Math.min(tileCount - 1, Math.max(meld.start, meld.end)),
      concealed: meld.concealed,
    }))
    .filter((meld) => meld.start <= meld.end && meld.start < tileCount && meld.end >= 0)
    .sort((left, right) => left.start - right.start);

  const merged: DeclaredMeld[] = [];
  for (const meld of clamped) {
    const last = merged[merged.length - 1];
    // Adjacent marks merge too: two melds declared side by side with no tile
    // between them cannot be told apart later, so treating them as one run and
    // letting the size check reject it is more honest than silently splitting.
    if (last && meld.start <= last.end + 1) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, meld.end),
        // A merged run is only concealed if everything in it was.
        concealed: last.concealed && meld.concealed,
      };
    } else {
      merged.push(meld);
    }
  }
  return merged;
}

/**
 * Split a flat hand into groups, with the marked runs as declared melds and
 * everything between them concealed and in hand.
 */
export function applyDeclaredMelds(
  tiles: readonly TileCode[],
  melds: readonly DeclaredMeld[],
): Grouping {
  const ranges = normaliseMelds(melds, tiles.length);
  const groups: TileCode[][] = [];
  const meldGroups: number[] = [];
  const concealedMelds: number[] = [];

  let cursor = 0;
  for (const meld of ranges) {
    if (meld.start > cursor) groups.push(tiles.slice(cursor, meld.start));
    groups.push(tiles.slice(meld.start, meld.end + 1));
    meldGroups.push(groups.length - 1);
    if (meld.concealed) concealedMelds.push(groups.length - 1);
    cursor = meld.end + 1;
  }
  if (cursor < tiles.length) groups.push(tiles.slice(cursor));

  // A hand with no melds is still one group, so the review screen always has
  // something to render.
  if (groups.length === 0) groups.push([]);
  return { groups, meldGroups, concealedMelds };
}

/** The declarations currently marked, in flat tile indices. */
export function declaredMelds(grouping: Grouping): DeclaredMeld[] {
  const melds: DeclaredMeld[] = [];
  let offset = 0;
  grouping.groups.forEach((group, index) => {
    if (grouping.meldGroups.includes(index) && group.length > 0) {
      melds.push({
        start: offset,
        end: offset + group.length - 1,
        concealed: grouping.concealedMelds.includes(index),
      });
    }
    offset += group.length;
  });
  return melds;
}

/** Every tile index covered by a declaration. */
export function meldedIndices(melds: readonly DeclaredMeld[]): Set<number> {
  const set = new Set<number>();
  for (const meld of melds) {
    for (let i = meld.start; i <= meld.end; i += 1) set.add(i);
  }
  return set;
}

/** Tile indices belonging to a declaration that was concealed. */
export function concealedIndices(melds: readonly DeclaredMeld[]): Set<number> {
  return meldedIndices(melds.filter((meld) => meld.concealed));
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
