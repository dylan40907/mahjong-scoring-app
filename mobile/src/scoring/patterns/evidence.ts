import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus, isNumbered } from '@/tiles/tileset';
import type { Meld } from '../hand';
import { meldSuit } from '../hand';
import {
  dragonTriplets,
  isDragonCode,
  isTerminalOrHonourCode,
  isWindCode,
  rankOf,
  windTriplets,
  type PatternContext,
} from './context';

/**
 * The tiles that earned a pattern, for the breakdown of a scored hand.
 *
 * Only where the answer is a particular set of tiles - the three dragon pungs
 * of Big Three Dragons, the two identical runs of a Pure Double Chow, the
 * flower that matched the seat. Patterns about the hand as a whole (a flush,
 * all honours, seven pairs) would only repeat the hand already drawn at the top
 * of the breakdown, and situational ones (no flowers, a concealed hand, the
 * last tile of the wall) have no tiles to point at. Those return null, and the
 * breakdown shows the words and the value alone.
 *
 * Groups rather than a flat list, so a pung reads as one set. Where a detector
 * could pick more than one set - two identical runs out of three - this picks
 * the first that qualifies; the point is to show the reason, not to re-run the
 * scorer's search.
 */
export function evidenceFor(id: string, ctx: PatternContext): TileCode[][] | null {
  const pick = EVIDENCE[id];
  if (!pick) return null;
  const groups = pick(ctx).filter((group) => group.length > 0);
  return groups.length > 0 ? groups : null;
}

type Picker = (ctx: PatternContext) => TileCode[][];

const tilesOf = (melds: readonly Meld[]): TileCode[][] => melds.map((meld) => [...meld.tiles]);

const withPair = (ctx: PatternContext, sets: readonly Meld[], test: (code: TileCode) => boolean) =>
  ctx.pair && test(ctx.pair.tiles[0]) ? [...tilesOf(sets), [...ctx.pair.tiles]] : tilesOf(sets);

/** The meld the winning tile completed, which is what every wait is about. */
const completed: Picker = (ctx) => {
  const meld = ctx.reading.melds.find((m) => m.completedByWin);
  return meld ? [[...meld.tiles]] : [];
};

const winningTile: Picker = (ctx) => [[ctx.winningTile]];

/** Chows keyed by suit and starting rank, for the runs-that-match family. */
function chowKeys(ctx: PatternContext): { suit: string; start: number; meld: Meld }[] {
  return ctx.chows.map((meld) => ({ suit: meldSuit(meld), start: rankOf(meld.tiles[0]), meld }));
}

/** The first `count` identical runs, if there are that many. */
function identicalChows(ctx: PatternContext, count: number): TileCode[][] {
  const bySignature = new Map<string, Meld[]>();
  for (const { suit, start, meld } of chowKeys(ctx)) {
    const key = `${suit}${start}`;
    bySignature.set(key, [...(bySignature.get(key) ?? []), meld]);
  }
  for (const melds of bySignature.values()) {
    if (melds.length >= count) return tilesOf(melds.slice(0, count));
  }
  return [];
}

/** One run starting at `start` in each of `suits` distinct suits. */
function sameRunAcrossSuits(ctx: PatternContext, suits: number): TileCode[][] {
  const keys = chowKeys(ctx);
  for (const { start } of keys) {
    const bySuit = new Map<string, Meld>();
    for (const key of keys) if (key.start === start && !bySuit.has(key.suit)) bySuit.set(key.suit, key.meld);
    if (bySuit.size >= suits) return tilesOf([...bySuit.values()].slice(0, suits));
  }
  return [];
}

/** Runs of 1-2-3, 4-5-6 and 7-8-9, in one suit or across three. */
function straight(ctx: PatternContext, oneSuit: boolean): TileCode[][] {
  const keys = chowKeys(ctx);
  const at = (start: number, suit?: string) =>
    keys.find((key) => key.start === start && (suit === undefined || key.suit === suit));
  if (oneSuit) {
    for (const { suit } of keys) {
      const run = [at(1, suit), at(4, suit), at(7, suit)];
      if (run.every(Boolean)) return run.map((key) => [...key!.meld.tiles]);
    }
    return [];
  }
  for (const low of keys.filter((key) => key.start === 1)) {
    for (const mid of keys.filter((key) => key.start === 4 && key.suit !== low.suit)) {
      const high = keys.find((key) => key.start === 7 && key.suit !== low.suit && key.suit !== mid.suit);
      if (high) return [low, mid, high].map((key) => [...key.meld.tiles]);
    }
  }
  return [];
}

/** Pungs of one rank in `suits` distinct numbered suits. */
function sameRankPungs(ctx: PatternContext, suits: number): TileCode[][] {
  const numbered = ctx.triplets.filter((meld) => isNumbered(TILE_BY_CODE[meld.tiles[0]]));
  for (const meld of numbered) {
    const rank = rankOf(meld.tiles[0]);
    const bySuit = new Map<string, Meld>();
    for (const other of numbered) {
      if (rankOf(other.tiles[0]) === rank && !bySuit.has(meldSuit(other))) bySuit.set(meldSuit(other), other);
    }
    if (bySuit.size >= suits) return tilesOf([...bySuit.values()].slice(0, suits));
  }
  return [];
}

const seatIndex = (ctx: PatternContext) =>
  ['east', 'south', 'west', 'north'].indexOf(ctx.seatWind) + 1;

const bonusOf = (ctx: PatternContext, suit?: 'flower' | 'season', rank?: number): TileCode[][] => {
  const tiles = ctx.bonus.filter((code) => {
    const tile = TILE_BY_CODE[code];
    if (!isBonus(tile)) return false;
    if (suit && tile.suit !== suit) return false;
    return rank === undefined || tile.rank === rank;
  });
  return tiles.length > 0 ? [tiles] : [];
};

const EVIDENCE: Readonly<Record<string, Picker>> = {
  // Honours
  'dragon-pung': (ctx) => tilesOf(dragonTriplets(ctx)),
  'two-dragon-pungs': (ctx) => tilesOf(dragonTriplets(ctx)),
  'big-three-dragons': (ctx) => tilesOf(dragonTriplets(ctx)),
  'little-three-dragons': (ctx) => withPair(ctx, dragonTriplets(ctx), isDragonCode),
  'seat-wind-pung': (ctx) => tilesOf(windTriplets(ctx).filter((m) => m.tiles[0] === ctx.seatWind)),
  'prevalent-wind-pung': (ctx) =>
    tilesOf(windTriplets(ctx).filter((m) => m.tiles[0] === ctx.roundWind)),
  'wind-pung': (ctx) => tilesOf(windTriplets(ctx)),
  'little-three-winds': (ctx) => withPair(ctx, windTriplets(ctx), isWindCode),
  'big-three-winds': (ctx) => tilesOf(windTriplets(ctx)),
  'little-four-winds': (ctx) => withPair(ctx, windTriplets(ctx), isWindCode),
  'big-four-winds': (ctx) => tilesOf(windTriplets(ctx)),
  'pung-of-terminals-or-honours': (ctx) =>
    tilesOf(ctx.triplets.filter((m) => isTerminalOrHonourCode(m.tiles[0]))),

  // Sets of three and four
  'all-pungs': (ctx) => tilesOf(ctx.triplets),
  'two-concealed-pungs': (ctx) => tilesOf(ctx.concealedTriplets),
  'three-concealed-pungs': (ctx) => tilesOf(ctx.concealedTriplets),
  'four-concealed-pungs': (ctx) => tilesOf(ctx.concealedTriplets),
  'five-concealed-pungs': (ctx) => tilesOf(ctx.concealedTriplets),
  'concealed-kong': (ctx) => tilesOf(ctx.concealedKongs),
  'two-concealed-kongs': (ctx) => tilesOf(ctx.concealedKongs),
  'melded-kong': (ctx) => tilesOf(ctx.meldedKongs),
  'two-melded-kongs': (ctx) => tilesOf(ctx.meldedKongs),
  'three-kongs': (ctx) => tilesOf(ctx.kongs),
  'four-kongs': (ctx) => tilesOf(ctx.kongs),
  'triple-pung': (ctx) => sameRankPungs(ctx, 3),
  'double-pung': (ctx) => sameRankPungs(ctx, 2),
  'tile-hog': (ctx) => {
    const kongTiles = new Set(ctx.kongs.map((kong) => kong.tiles[0]));
    for (const [code, count] of ctx.counts) {
      if (count === 4 && !kongTiles.has(code)) return [[code, code, code, code]];
    }
    return [];
  },

  // Runs
  'pure-double-chow': (ctx) => identicalChows(ctx, 2),
  'pure-triple-chow': (ctx) => identicalChows(ctx, 3),
  'quadruple-chow': (ctx) => identicalChows(ctx, 4),
  'mixed-double-chow': (ctx) => sameRunAcrossSuits(ctx, 2),
  'mixed-triple-chow': (ctx) => sameRunAcrossSuits(ctx, 3),
  'pure-straight': (ctx) => straight(ctx, true),
  'mixed-straight': (ctx) => straight(ctx, false),

  // How it was won
  'edge-wait': completed,
  'closed-wait': completed,
  'single-wait': completed,
  'self-drawn': winningTile,
  'last-tile-draw': winningTile,
  'last-tile-claim': winningTile,
  'last-tile': winningTile,
  'out-with-replacement-tile': winningTile,
  'robbing-the-kong': winningTile,

  // Flowers and seasons
  'flower-tiles': (ctx) => bonusOf(ctx),
  'seat-flower': (ctx) => bonusOf(ctx, 'flower', seatIndex(ctx)),
  'seat-season': (ctx) => bonusOf(ctx, 'season', seatIndex(ctx)),
  'all-flowers': (ctx) => bonusOf(ctx, 'flower'),
  'all-seasons': (ctx) => bonusOf(ctx, 'season'),
  'all-eight-bonus': (ctx) => bonusOf(ctx),
};
