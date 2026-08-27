import type { Suit, TileCode, Wind } from '@/tiles/tileset';
import {
  DRAGON_CODES,
  TILE_BY_CODE,
  isBonus,
  isHonour,
  isNumbered,
  isTerminal,
  isTerminalOrHonour,
} from '@/tiles/tileset';
import type { Decomposition, HandInput, Meld } from '../hand';
import { countTiles, isTripletLike, meldSuit } from '../hand';

/**
 * Everything a pattern detector needs, computed once per reading.
 *
 * Roughly ninety detectors run against each reading, and most of them want the
 * same handful of derived facts - which melds are triplets, which suits appear,
 * whether anything is exposed. Computing those once per reading rather than
 * once per detector turns the scoring pass from quadratic-ish into linear, and
 * more importantly it means every detector agrees on the answers.
 */
export interface PatternContext {
  readonly hand: HandInput;
  readonly reading: Decomposition;
  readonly handSize: number;

  /** Melds excluding the pair. */
  readonly sets: readonly Meld[];
  readonly chows: readonly Meld[];
  readonly triplets: readonly Meld[];
  readonly kongs: readonly Meld[];
  readonly concealedTriplets: readonly Meld[];
  readonly concealedKongs: readonly Meld[];
  readonly meldedKongs: readonly Meld[];
  readonly pair: Meld | null;

  /** Every tile in the hand proper, bonuses excluded. */
  readonly tiles: readonly TileCode[];
  readonly counts: ReadonlyMap<TileCode, number>;
  readonly bonus: readonly TileCode[];

  readonly numberedSuits: ReadonlySet<Suit>;
  readonly hasHonours: boolean;
  readonly hasTerminals: boolean;
  readonly hasSimples: boolean;

  /** No meld was formed by claiming a discard. */
  readonly isConcealed: boolean;
  /** Every set was claimed from a discard - MCR's Melded Hand. */
  readonly allSetsMelded: boolean;

  readonly seatWind: Wind;
  readonly roundWind: Wind;
  readonly winningTile: TileCode;
  readonly selfDrawn: boolean;
}

const WIND_ORDER: readonly Wind[] = ['east', 'south', 'west', 'north'];

export function buildContext(
  hand: HandInput,
  reading: Decomposition,
  handSize: number,
): PatternContext {
  const sets = reading.melds.filter((m) => m.kind !== 'pair');
  const chows = sets.filter((m) => m.kind === 'chow');
  const triplets = sets.filter(isTripletLike);
  const kongs = sets.filter((m) => m.kind === 'kong');
  const tiles = reading.melds.flatMap((m) => [...m.tiles]).filter((c) => !isBonus(TILE_BY_CODE[c]));

  const numberedSuits = new Set<Suit>();
  let hasHonoursFlag = false;
  let hasTerminalsFlag = false;
  let hasSimplesFlag = false;
  for (const code of tiles) {
    const tile = TILE_BY_CODE[code];
    if (isNumbered(tile)) {
      numberedSuits.add(tile.suit);
      if (isTerminal(tile)) hasTerminalsFlag = true;
      else hasSimplesFlag = true;
    } else if (isHonour(tile)) {
      hasHonoursFlag = true;
    }
  }

  return {
    hand,
    reading,
    handSize,
    sets,
    chows,
    triplets,
    kongs,
    concealedTriplets: triplets.filter((m) => m.concealed),
    concealedKongs: kongs.filter((m) => m.concealed),
    meldedKongs: kongs.filter((m) => !m.concealed),
    pair: reading.pair,
    tiles,
    counts: countTiles(tiles),
    bonus: hand.bonus,
    numberedSuits,
    hasHonours: hasHonoursFlag,
    hasTerminals: hasTerminalsFlag,
    hasSimples: hasSimplesFlag,
    isConcealed: reading.melds.every((m) => m.concealed),
    allSetsMelded: sets.length > 0 && sets.every((m) => !m.concealed),
    seatWind: hand.context.seatWind,
    roundWind: hand.context.roundWind,
    winningTile: hand.winningTile,
    selfDrawn: hand.context.selfDrawn,
  };
}

// ---------------------------------------------------------------------------
// Shared predicates used by many detectors
// ---------------------------------------------------------------------------

export function isDragonCode(code: TileCode): boolean {
  return (DRAGON_CODES as readonly string[]).includes(code);
}

export function isWindCode(code: TileCode): boolean {
  return (WIND_ORDER as readonly string[]).includes(code);
}

/** Triplets or kongs of the given tile family. */
export function tripletsOf(ctx: PatternContext, predicate: (code: TileCode) => boolean): Meld[] {
  return ctx.triplets.filter((m) => predicate(m.tiles[0]));
}

export function dragonTriplets(ctx: PatternContext): Meld[] {
  return tripletsOf(ctx, isDragonCode);
}

export function windTriplets(ctx: PatternContext): Meld[] {
  return tripletsOf(ctx, isWindCode);
}

export function pairIsDragon(ctx: PatternContext): boolean {
  return ctx.pair !== null && isDragonCode(ctx.pair.tiles[0]);
}

export function pairIsWind(ctx: PatternContext): boolean {
  return ctx.pair !== null && isWindCode(ctx.pair.tiles[0]);
}

/** Every tile in the hand satisfies the predicate. */
export function allTiles(ctx: PatternContext, predicate: (code: TileCode) => boolean): boolean {
  return ctx.tiles.length > 0 && ctx.tiles.every(predicate);
}

export function everyMeld(ctx: PatternContext, predicate: (meld: Meld) => boolean): boolean {
  return ctx.reading.melds.length > 0 && ctx.reading.melds.every(predicate);
}

export function isTerminalOrHonourCode(code: TileCode): boolean {
  return isTerminalOrHonour(TILE_BY_CODE[code]);
}

export function isSimpleCode(code: TileCode): boolean {
  const tile = TILE_BY_CODE[code];
  return isNumbered(tile) && tile.rank >= 2 && tile.rank <= 8;
}

export function rankOf(code: TileCode): number {
  return TILE_BY_CODE[code].rank;
}

export function suitOf(code: TileCode): Suit {
  return TILE_BY_CODE[code].suit;
}

/** A meld touching at least one terminal or honour, as "outside hand" needs. */
export function touchesTerminalOrHonour(meld: Meld): boolean {
  return meld.tiles.some(isTerminalOrHonourCode);
}

/** A meld touching at least one terminal, with no honours - "fully outside". */
export function touchesTerminalNoHonour(meld: Meld): boolean {
  return (
    meld.tiles.every((c) => isNumbered(TILE_BY_CODE[c])) &&
    meld.tiles.some((c) => isTerminal(TILE_BY_CODE[c]))
  );
}

/** Chow start ranks grouped by suit, for the shifted/straight family. */
export function chowStartsBySuit(ctx: PatternContext): Map<Suit, number[]> {
  const map = new Map<Suit, number[]>();
  for (const chow of ctx.chows) {
    const suit = meldSuit(chow) as Suit;
    const list = map.get(suit) ?? [];
    list.push(rankOf(chow.tiles[0]));
    map.set(suit, list);
  }
  for (const list of map.values()) list.sort((a, b) => a - b);
  return map;
}

/** Triplet ranks grouped by suit, for the pung equivalents. */
export function tripletRanksBySuit(ctx: PatternContext): Map<Suit, number[]> {
  const map = new Map<Suit, number[]>();
  for (const triplet of ctx.triplets) {
    const code = triplet.tiles[0];
    const tile = TILE_BY_CODE[code];
    if (!isNumbered(tile)) continue;
    const list = map.get(tile.suit) ?? [];
    list.push(tile.rank);
    map.set(tile.suit, list);
  }
  for (const list of map.values()) list.sort((a, b) => a - b);
  return map;
}

export const NUMBERED: readonly Suit[] = ['man', 'pin', 'sou'];

/** Count how many of the three numbered suits appear at all. */
export function suitCount(ctx: PatternContext): number {
  return ctx.numberedSuits.size;
}

export function windIndex(wind: Wind): number {
  return WIND_ORDER.indexOf(wind);
}
