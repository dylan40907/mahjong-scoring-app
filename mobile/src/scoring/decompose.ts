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
 * The player supplies two bags of tiles - what was in hand, and what had been
 * melded - and never a grouping. Grouping is what this file is for. Asking the
 * user to draw the meld boundaries was asking them to do the parser's job, and
 * it went wrong in the way that request always goes wrong: a concealed kong is
 * set down but never shown, so "declare your melds" had no honest answer for
 * it, and the four tiles either vanished from the count or lied about being
 * exposed.
 *
 * Kongs fall out of the arithmetic instead. A kong is four tiles doing the
 * work of three, so a hand carrying one is one tile over the nominal size and
 * a hand carrying two is two over - and a kong is the only thing that can do
 * that, since flowers are set aside before any of this. So the surplus *is*
 * the number of kongs, and the search simply looks for readings that use that
 * many. If none exists, the tiles do not form a hand, which is a far better
 * answer than scoring a grouping the player was talked into.
 *
 * Search cost is bounded. Every branch consumes the lowest remaining tile, so
 * no state is reachable twice, and both bags are capped.
 */

const MAX_DECOMPOSITIONS = 512;
const MAX_PARTITIONS = 256;

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
 * Every way to consume `counts` entirely into sets, with none left over.
 *
 * Always works on the lowest remaining tile: any valid set containing it must
 * start with it - a chow cannot have it in the middle or at the top, or a
 * lower tile would still be present - so the three branches below are
 * exhaustive and no arrangement is reached twice.
 */
function partitionSets(
  counts: Counts,
  concealed: boolean,
  acc: Meld[],
  out: Meld[][],
): void {
  if (out.length >= MAX_PARTITIONS) return;
  const head = lowestTile(counts);
  if (head === null) {
    out.push([...acc]);
    return;
  }

  const available = counts.get(head) ?? 0;

  // Kong. Tried before the triplet so that a reading using the kong is found
  // first, but both survive: four identical tiles are sometimes a kong and
  // sometimes a triplet with the fourth tile spent inside a run.
  if (available >= 4) {
    const next = cloneCounts(counts);
    take(next, head, 4);
    acc.push({ kind: 'kong', tiles: [head, head, head, head], concealed });
    partitionSets(next, concealed, acc, out);
    acc.pop();
  }

  // Triplet.
  if (available >= 3) {
    const next = cloneCounts(counts);
    take(next, head, 3);
    acc.push({ kind: 'pung', tiles: [head, head, head], concealed });
    partitionSets(next, concealed, acc, out);
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
      acc.push({ kind: 'chow', tiles: [head, second, third], concealed });
      partitionSets(next, concealed, acc, out);
      acc.pop();
    }
  }
}

interface StandardReading {
  readonly sets: Meld[];
  readonly pair: Meld;
}

/**
 * Readings of the standard shape: `sets` sets and one pair.
 *
 * The two bags are partitioned independently and then paired up, which is what
 * enforces the one rule the player cannot break: a meld is either on the table
 * or in the hand, never half of each. It also means the pair can only come
 * from the concealed bag, because a pair is never set down.
 */
function standardReadings(
  concealed: readonly TileCode[],
  exposed: readonly TileCode[],
  sets: number,
): StandardReading[] {
  const exposedPartitions: Meld[][] = [];
  partitionSets(countTiles(exposed), false, [], exposedPartitions);
  if (exposedPartitions.length === 0) return [];

  const counts = countTiles(concealed);
  const readings: StandardReading[] = [];

  for (const [code, n] of counts) {
    if (n < 2) continue;
    const remaining = cloneCounts(counts);
    take(remaining, code, 2);

    const concealedPartitions: Meld[][] = [];
    partitionSets(remaining, true, [], concealedPartitions);
    if (concealedPartitions.length === 0) continue;

    for (const inHand of concealedPartitions) {
      for (const onTable of exposedPartitions) {
        if (onTable.length + inHand.length !== sets) continue;
        readings.push({
          sets: [...onTable, ...inHand],
          pair: { kind: 'pair', tiles: [code, code], concealed: true },
        });
        if (readings.length >= MAX_DECOMPOSITIONS) return readings;
      }
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
    // Seven *different* pairs. Four identical tiles are one pair and two spare
    // tiles, not two pairs - the rule is explicit in Riichi and is the ordinary
    // reading everywhere else the shape is played. Allowing it here, which this
    // used to on the promise that rulesets would filter it out later, paid out
    // on a hand that is not a winning hand at all.
    if (n !== 2) return null;
    pairs.push({ kind: 'pair', tiles: [code, code], concealed: true });
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
    kind: 'pair' as const,
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

function handTiles(hand: HandInput): { concealed: TileCode[]; exposed: TileCode[] } {
  return {
    concealed: hand.concealed.filter((code) => !isBonus(TILE_BY_CODE[code])),
    exposed: hand.exposed.filter((code) => !isBonus(TILE_BY_CODE[code])),
  };
}

/**
 * How many kongs a hand of this size must contain, or null if no number works.
 *
 * A kong is the only thing that can push a hand past its nominal size - every
 * other tile is either part of a set, part of the pair, or a flower, and
 * flowers were set aside long before this. So the surplus is the kong count,
 * and a surplus larger than the number of sets in the hand is simply not a
 * hand.
 */
export function kongsImpliedBy(tileCount: number, handSize: number): number | null {
  const surplus = tileCount - (handSize + 1);
  if (surplus < 0 || surplus > setsForHandSize(handSize)) return null;
  return surplus;
}

/**
 * Every valid reading of a winning hand.
 *
 * Returns an empty array when the tiles do not form a winning hand at all,
 * which is how callers detect an incomplete or mis-entered hand.
 */
export function decompose(hand: HandInput, options: DecomposeOptions): Decomposition[] {
  const { concealed, exposed } = handTiles(hand);
  const sets = setsForHandSize(options.handSize);
  const results: Decomposition[] = [];

  if (kongsImpliedBy(concealed.length + exposed.length, options.handSize) !== null) {
    for (const { sets: found, pair } of standardReadings(concealed, exposed, sets)) {
      results.push(...withWinningMeld([...found, pair], pair, hand.winningTile, undefined));
    }
  }

  // Special shapes are all-concealed by definition: you cannot claim a tile
  // into seven pairs or thirteen orphans and still have the shape.
  if (options.allowSevenPairs !== false && exposed.length === 0) {
    if (options.handSize === 16) {
      /*
       * The Taiwanese analogue is seven pairs *plus a triplet*, not eight
       * pairs. Eight pairs is sixteen tiles and a winning Taiwanese hand is
       * seventeen, so the eight-pair reading could never match a real hand -
       * it was asking for a tile count that does not occur.
       */
      const mixed = eightPairsTripletReading(concealed);
      if (mixed) results.push(...withWinningMeld(mixed, null, hand.winningTile, 'eight-pairs-triplet'));
    } else {
      const pairs = sevenPairsReading(concealed, 7);
      if (pairs) results.push(...withWinningMeld(pairs, null, hand.winningTile, 'seven-pairs'));
    }
  }

  if (
    options.allowThirteenOrphans !== false &&
    exposed.length === 0 &&
    options.handSize === 13
  ) {
    const orphans = thirteenOrphansReading(concealed);
    if (orphans) results.push(...withWinningMeld(orphans, null, hand.winningTile, 'thirteen-orphans'));
  }

  return dedupe(results);
}

/**
 * Whether the melded tiles form whole sets on their own.
 *
 * A meld is either on the table or in the hand, never half of each, so this is
 * checkable without looking at the rest of the hand - and it is the mistake
 * worth naming, because the alternative is telling somebody their eighteen
 * tiles are not a hand when what actually happened is that they swept one tile
 * too many.
 */
export function meldedTilesFormSets(exposed: readonly TileCode[]): boolean {
  const clean = exposed.filter((code) => !isBonus(TILE_BY_CODE[code]));
  if (clean.length === 0) return true;
  const out: Meld[][] = [];
  partitionSets(countTiles(clean), false, [], out);
  return out.length > 0;
}

/**
 * Whether these tiles form a complete hand at all, ignoring which tile won it.
 *
 * The review screen needs this before a winning tile has been chosen: it is
 * what turns "18 of 17 tiles" into either "one kong" or "these tiles do not
 * make a hand", and it is the only honest way to answer that, since whether
 * the surplus tile is a kong depends on the rest of the hand.
 */
export function formsCompleteHand(
  concealed: readonly TileCode[],
  exposed: readonly TileCode[],
  options: DecomposeOptions,
): boolean {
  const clean = {
    concealed: concealed.filter((code) => !isBonus(TILE_BY_CODE[code])),
    exposed: exposed.filter((code) => !isBonus(TILE_BY_CODE[code])),
  };
  const total = clean.concealed.length + clean.exposed.length;

  if (kongsImpliedBy(total, options.handSize) !== null) {
    const sets = setsForHandSize(options.handSize);
    if (standardReadings(clean.concealed, clean.exposed, sets).length > 0) return true;
  }
  if (clean.exposed.length > 0) return false;

  if (options.allowSevenPairs !== false) {
    if (options.handSize === 16) {
      if (eightPairsTripletReading(clean.concealed)) return true;
    } else if (sevenPairsReading(clean.concealed, 7)) {
      return true;
    }
  }
  if (options.allowThirteenOrphans !== false && options.handSize === 13) {
    if (thirteenOrphansReading(clean.concealed)) return true;
  }
  return false;
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
    /*
     * The winning tile sits in a meld already on the table - robbing a kong,
     * or a hand whose last tile completed something claimed.
     *
     * The wait is genuinely unclassifiable here, and calling it a single wait
     * (which this used to) handed out a wait bonus nobody earned: one tai in
     * Taiwanese, two fu in Riichi, on every such hand.
     */
    out.push({ melds, pair, special, winningMeldIndex: -1, waitType: 'none' });
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
