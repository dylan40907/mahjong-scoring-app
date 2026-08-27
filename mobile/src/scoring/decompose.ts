import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus, isNumbered, isTerminalOrHonour, tileOffset } from '@/tiles/tileset';
import type { Decomposition, HandInput, Meld, WaitType } from './hand';
import { countTiles, setsForHandSize } from './hand';

/**
 * Parse a winning hand into every structurally valid reading.
 *
 * This is the load-bearing piece of the scoring engine. Patterns are detected
 * against a reading, not against a bag of tiles, so a missed reading is a
 * missed score and a spurious one is an inflated score. The enumeration is
 * exhaustive rather than greedy: `111234` genuinely is both "pung of 1s, then
 * 2-3-4 needs a 4" and "1-2-3 run plus a pair of 1s", and which one is worth
 * more depends on the ruleset.
 *
 * Search cost is bounded and small. A 17-tile Taiwanese hand has at most a few
 * hundred readings, and the recursion always consumes the lowest remaining
 * tile, so it cannot revisit a state.
 */

const MAX_DECOMPOSITIONS = 512;

// ---------------------------------------------------------------------------
// Standard shape: N sets plus one pair
// ---------------------------------------------------------------------------

type Counts = Map<TileCode, number>;

function cloneCounts(counts: Counts): Counts {
  return new Map(counts);
}

function take(counts: Counts, code: TileCode, n: number): boolean {
  const have = counts.get(code) ?? 0;
  if (have < n) return false;
  if (have === n) counts.delete(code);
  else counts.set(code, have - n);
  return true;
}

function lowestTile(counts: Counts): TileCode | null {
  let best: TileCode | null = null;
  let bestIndex = Infinity;
  for (const [code, n] of counts) {
    if (n <= 0) continue;
    const index = TILE_BY_CODE[code].index;
    if (index < bestIndex) {
      bestIndex = index;
      best = code;
    }
  }
  return best;
}

/**
 * Split `counts` into exactly `need` sets, returning every distinct way.
 *
 * Always works on the lowest remaining tile: any valid set containing it must
 * start with it (a chow cannot have it in the middle or at the top, or a lower
 * tile would still be present), so the two branches below are exhaustive.
 */
function enumerateSets(counts: Counts, need: number, acc: Meld[], out: Meld[][]): void {
  if (out.length >= MAX_DECOMPOSITIONS) return;
  if (need === 0) {
    if (counts.size === 0) out.push([...acc]);
    return;
  }
  const head = lowestTile(counts);
  if (head === null) return;

  // Triplet.
  if ((counts.get(head) ?? 0) >= 3) {
    const next = cloneCounts(counts);
    take(next, head, 3);
    acc.push({ kind: 'pung', tiles: [head, head, head], concealed: true });
    enumerateSets(next, need - 1, acc, out);
    acc.pop();
  }

  // Run. Only numbered suits, and only upward from the lowest tile.
  const tile = TILE_BY_CODE[head];
  if (isNumbered(tile)) {
    const second = tileOffset(head, 1);
    const third = tileOffset(head, 2);
    if (second && third && (counts.get(second) ?? 0) > 0 && (counts.get(third) ?? 0) > 0) {
      const next = cloneCounts(counts);
      take(next, head, 1);
      take(next, second, 1);
      take(next, third, 1);
      acc.push({ kind: 'chow', tiles: [head, second, third], concealed: true });
      enumerateSets(next, need - 1, acc, out);
      acc.pop();
    }
  }
}

function standardReadings(concealed: readonly TileCode[], setsNeeded: number): { sets: Meld[]; pair: Meld }[] {
  const counts = countTiles(concealed);
  const readings: { sets: Meld[]; pair: Meld }[] = [];

  for (const [code, n] of counts) {
    if (n < 2) continue;
    const remaining = cloneCounts(counts);
    take(remaining, code, 2);
    const found: Meld[][] = [];
    enumerateSets(remaining, setsNeeded, [], found);
    for (const sets of found) {
      readings.push({
        sets,
        pair: { kind: 'pair', tiles: [code, code], concealed: true },
      });
    }
  }
  return readings;
}

// ---------------------------------------------------------------------------
// Special shapes
// ---------------------------------------------------------------------------

const THIRTEEN_ORPHAN_CODES: TileCode[] = [
  'man1', 'man9', 'pin1', 'pin9', 'sou1', 'sou9',
  'east', 'south', 'west', 'north', 'red', 'green', 'white',
];

function sevenPairsReading(concealed: readonly TileCode[], pairsNeeded: number): Meld[] | null {
  if (concealed.length !== pairsNeeded * 2) return null;
  const counts = countTiles(concealed);
  const pairs: Meld[] = [];
  for (const [code, n] of counts) {
    // Four identical tiles read as two pairs in most rules that allow the
    // shape at all; rulesets that forbid it filter the reading out later.
    if (n % 2 !== 0) return null;
    for (let i = 0; i < n / 2; i += 1) {
      pairs.push({ kind: 'pair', tiles: [code, code], concealed: true });
    }
  }
  return pairs.length === pairsNeeded ? pairs : null;
}

/** Taiwanese 17-tile analogue: seven pairs plus one triplet. */
function eightPairsTripletReading(concealed: readonly TileCode[]): Meld[] | null {
  if (concealed.length !== 17) return null;
  const counts = countTiles(concealed);
  let triplets = 0;
  const melds: Meld[] = [];
  for (const [code, n] of counts) {
    if (n === 2) melds.push({ kind: 'pair', tiles: [code, code], concealed: true });
    else if (n === 3) {
      triplets += 1;
      melds.push({ kind: 'pung', tiles: [code, code, code], concealed: true });
    } else return null;
  }
  return triplets === 1 && melds.length === 8 ? melds : null;
}

function thirteenOrphansReading(concealed: readonly TileCode[]): Meld[] | null {
  if (concealed.length !== 14) return null;
  const counts = countTiles(concealed);
  if (counts.size !== 13) return null;
  for (const code of THIRTEEN_ORPHAN_CODES) {
    const n = counts.get(code) ?? 0;
    if (n < 1) return null;
  }
  for (const [code] of counts) {
    if (!isTerminalOrHonour(TILE_BY_CODE[code])) return null;
  }
  return [...counts.entries()].map(([code, n]) => ({
    kind: n === 2 ? ('pair' as const) : ('pair' as const),
    tiles: n === 2 ? [code, code] : [code],
    concealed: true,
  }));
}

// ---------------------------------------------------------------------------
// Wait classification
// ---------------------------------------------------------------------------

function classifyWait(meld: Meld, winningTile: TileCode): WaitType {
  if (meld.kind === 'pair') return 'single';
  if (meld.kind === 'pung' || meld.kind === 'kong') return 'pung';

  const position = meld.tiles.indexOf(winningTile);
  if (position === 1) return 'closed';

  // An end tile completes an edge wait only when the other end is unusable:
  // 1-2 can only be waiting on 3, and 8-9 only on 7.
  const first = TILE_BY_CODE[meld.tiles[0]];
  if (position === 2 && first.rank === 1) return 'edge';
  if (position === 0 && TILE_BY_CODE[meld.tiles[2]].rank === 9) return 'edge';
  return 'open';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DecomposeOptions {
  /** Tiles in a complete hand for this variant: 13 for most, 16 for Taiwanese. */
  readonly handSize: number;
  readonly allowSevenPairs?: boolean;
  readonly allowThirteenOrphans?: boolean;
}

/**
 * Every valid reading of a winning hand.
 *
 * Returns an empty array when the tiles do not form a winning hand at all,
 * which is how callers detect an incomplete or mis-entered hand.
 */
export function decompose(hand: HandInput, options: DecomposeOptions): Decomposition[] {
  const concealed = hand.concealed.filter((code) => !isBonus(TILE_BY_CODE[code]));
  const declaredSets = hand.melds.length;
  const setsNeeded = setsForHandSize(options.handSize) - declaredSets;
  const results: Decomposition[] = [];

  if (setsNeeded >= 0) {
    const expected = setsNeeded * 3 + 2;
    if (concealed.length === expected) {
      for (const { sets, pair } of standardReadings(concealed, setsNeeded)) {
        const melds = [...hand.melds, ...sets, pair];
        results.push(...withWinningMeld(melds, pair, hand.winningTile, undefined));
      }
    }
  }

  if (options.allowSevenPairs !== false) {
    const pairsNeeded = options.handSize === 16 ? 8 : 7;
    if (declaredSets === 0) {
      const pairs = sevenPairsReading(concealed, pairsNeeded);
      if (pairs) {
        results.push(
          ...withWinningMeld(pairs, null, hand.winningTile, options.handSize === 16 ? 'eight-pairs-triplet' : 'seven-pairs'),
        );
      }
      if (options.handSize === 16) {
        const mixed = eightPairsTripletReading(concealed);
        if (mixed) results.push(...withWinningMeld(mixed, null, hand.winningTile, 'eight-pairs-triplet'));
      }
    }
  }

  if (options.allowThirteenOrphans !== false && declaredSets === 0 && options.handSize === 13) {
    const orphans = thirteenOrphansReading(concealed);
    if (orphans) results.push(...withWinningMeld(orphans, null, hand.winningTile, 'thirteen-orphans'));
  }

  return dedupe(results);
}

/**
 * Expand a reading into one variant per meld the winning tile could belong to.
 *
 * The choice is not cosmetic: the same tiles scored as a concealed triplet
 * completed by self-draw and as a run completed on a two-sided wait differ by
 * several points in every ruleset here, and the player is entitled to the
 * better reading.
 */
function withWinningMeld(
  melds: Meld[],
  pair: Meld | null,
  winningTile: TileCode,
  special: Decomposition['special'],
): Decomposition[] {
  const out: Decomposition[] = [];
  for (let i = 0; i < melds.length; i += 1) {
    const meld = melds[i];
    if (!meld.concealed) continue;
    if (!meld.tiles.includes(winningTile)) continue;
    const marked = melds.map((m, index) =>
      index === i ? { ...m, completedByWin: true } : m,
    );
    out.push({
      melds: marked,
      pair: pair ? (marked.find((m) => m.kind === 'pair' && m.tiles[0] === pair.tiles[0]) ?? pair) : null,
      special,
      winningMeldIndex: i,
      waitType: classifyWait(meld, winningTile),
    });
  }
  if (out.length === 0) {
    // The winning tile sits in an exposed meld, or the hand was claimed in a
    // way that leaves no concealed home for it.
    out.push({ melds, pair, special, winningMeldIndex: -1, waitType: 'single' });
  }
  return out;
}

function signature(d: Decomposition): string {
  const melds = d.melds
    .map((m) => `${m.kind}:${m.tiles.join(',')}:${m.concealed ? 'c' : 'o'}${m.completedByWin ? 'w' : ''}`)
    .sort()
    .join('|');
  return `${d.special ?? 'standard'}#${melds}#${d.waitType}`;
}

function dedupe(list: Decomposition[]): Decomposition[] {
  const seen = new Set<string>();
  const out: Decomposition[] = [];
  for (const item of list) {
    const key = signature(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
