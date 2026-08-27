import type { TileCode, Wind } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus, isHonour, isNumbered, isTerminalOrHonour } from '@/tiles/tileset';

/**
 * The shapes a scoring engine reasons about.
 *
 * Every variant this app supports - Taiwanese, Hong Kong, Riichi, MCR - reads
 * the same board state and disagrees only about what that state is worth. So
 * the hand model is shared and completely rule-agnostic: it records what the
 * player is holding and how the hand was won, and nothing about scoring.
 */

export type MeldKind = 'chow' | 'pung' | 'kong' | 'pair';

export interface Meld {
  readonly kind: MeldKind;
  /** Ascending tile order. Chow is three consecutive, kong is four identical. */
  readonly tiles: readonly TileCode[];
  /**
   * True for a meld nobody else saw formed: tiles drawn from the wall, or a
   * declared concealed kong. A meld completed by claiming a discard is open,
   * and a great many patterns halve or vanish when the hand contains one.
   */
  readonly concealed: boolean;
  /** True for the meld the winning tile completed. */
  readonly completedByWin?: boolean;
}

/** How the final tile fitted in. Riichi prices these; MCR scores three of them. */
export type WaitType =
  | 'edge'    // penchan: 1-2 waiting on 3, or 8-9 waiting on 7
  | 'closed'  // kanchan: 4-_-6 waiting on 5
  | 'open'    // ryanmen: 4-5 waiting on 3 or 6
  | 'single'  // tanki: the pair was the wait
  | 'pung';   // shanpon: two pairs, one became a triplet

export interface HandContext {
  /** Won on a tile drawn from the wall rather than claimed from a discard. */
  readonly selfDrawn: boolean;
  readonly seatWind: Wind;
  readonly roundWind: Wind;
  readonly isDealer: boolean;

  /** Won on the very last tile of the live wall. */
  readonly lastTileFromWall?: boolean;
  /** Won on the final discard of the hand. */
  readonly lastDiscard?: boolean;
  /** Won by claiming the tile another player was adding to a melded pung. */
  readonly robbingKong?: boolean;
  /** Won on the replacement tile drawn after declaring a kong. */
  readonly afterKong?: boolean;
  /** The last tile of its kind: all other three are visible. */
  readonly lastTileOfKind?: boolean;

  // Riichi-specific declarations.
  readonly riichi?: boolean;
  readonly doubleRiichi?: boolean;
  readonly ippatsu?: boolean;
  readonly dora?: number;

  /** Dealer wins on the dealt hand. */
  readonly heavenly?: boolean;
  /** Non-dealer wins on the dealer's first discard. */
  readonly earthly?: boolean;

  /** Discards made before the win, used by Taiwanese early-win bonuses. */
  readonly discardsBeforeWin?: number;
  /** The hand was ready as dealt, before any draw. */
  readonly readyOnDeal?: boolean;
}

export interface HandInput {
  /** Concealed tiles at the moment of winning, including the winning tile. */
  readonly concealed: readonly TileCode[];
  /** Exposed melds, plus any declared concealed kong. */
  readonly melds: readonly Meld[];
  /** Flowers and seasons, set aside from the hand proper. */
  readonly bonus: readonly TileCode[];
  readonly winningTile: TileCode;
  readonly context: HandContext;
}

/** A special hand that does not decompose into sets and a pair. */
export type SpecialShape =
  | 'seven-pairs'
  | 'thirteen-orphans'
  | 'eight-pairs-triplet'   // Taiwanese 17-tile analogue of seven pairs
  | 'knitted-straight';

/**
 * One valid reading of a hand.
 *
 * A hand often parses more than one way - 1112345 can be a pung of ones plus a
 * 2-3-4 run, or 1-2-3 plus 1 and 4-5 - and the readings are not worth the
 * same. Scoring enumerates every reading and keeps the best, which is both
 * what the rules intend and what a player would do for themselves.
 */
export interface Decomposition {
  /** Every meld: exposed, concealed, and the pair, in that structural order. */
  readonly melds: readonly Meld[];
  readonly pair: Meld | null;
  readonly special?: SpecialShape;
  /** Index into `melds` of the meld the winning tile completed, or -1. */
  readonly winningMeldIndex: number;
  readonly waitType: WaitType;
}

// ---------------------------------------------------------------------------
// Tile-count helpers
// ---------------------------------------------------------------------------

export type TileCounts = Map<TileCode, number>;

export function countTiles(tiles: readonly TileCode[]): TileCounts {
  const counts: TileCounts = new Map();
  for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  return counts;
}

export function meldTiles(melds: readonly Meld[]): TileCode[] {
  return melds.flatMap((meld) => [...meld.tiles]);
}

/** Every tile in the hand proper. Bonus tiles are excluded by definition. */
export function allHandTiles(hand: HandInput): TileCode[] {
  return [...hand.concealed, ...meldTiles(hand.melds)];
}

/**
 * The distinct tiles a meld represents, collapsing a kong to one.
 *
 * Used by pattern detectors that care about which tile a set is made of
 * rather than how many copies were laid down.
 */
export function meldHead(meld: Meld): TileCode {
  return meld.tiles[0];
}

export function isSetMeld(meld: Meld): boolean {
  return meld.kind !== 'pair';
}

export function isTripletLike(meld: Meld): boolean {
  return meld.kind === 'pung' || meld.kind === 'kong';
}

export function meldIsTerminalOrHonour(meld: Meld): boolean {
  return meld.tiles.some((code) => isTerminalOrHonour(TILE_BY_CODE[code]));
}

export function meldIsAllTerminalOrHonour(meld: Meld): boolean {
  return meld.tiles.every((code) => isTerminalOrHonour(TILE_BY_CODE[code]));
}

export function meldSuit(meld: Meld): string {
  return TILE_BY_CODE[meld.tiles[0]].suit;
}

/** Numbered suits present in the hand, ignoring honours and bonuses. */
export function suitsUsed(tiles: readonly TileCode[]): Set<string> {
  const suits = new Set<string>();
  for (const code of tiles) {
    const tile = TILE_BY_CODE[code];
    if (isNumbered(tile)) suits.add(tile.suit);
  }
  return suits;
}

export function hasHonours(tiles: readonly TileCode[]): boolean {
  return tiles.some((code) => isHonour(TILE_BY_CODE[code]));
}

export function hasBonus(tiles: readonly TileCode[]): boolean {
  return tiles.some((code) => isBonus(TILE_BY_CODE[code]));
}

/** True when no meld was formed by claiming a discard. */
export function isFullyConcealed(hand: HandInput): boolean {
  return hand.melds.every((meld) => meld.concealed);
}

/** The number of sets (excluding the pair) a hand of this size needs. */
export function setsForHandSize(handSize: number): number {
  return Math.floor((handSize - 1) / 3);
}
