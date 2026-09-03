import type { Suit, TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus, isHonour, isNumbered, isTerminal } from '@/tiles/tileset';
import type {} from '../hand';
import {
  chowStartsBySuit,
  dragonTriplets,
  isDragonCode,
  isSimpleCode,
  isTerminalOrHonourCode,
  isWindCode,
  NUMBERED,
  type PatternContext,
  pairIsDragon,
  rankOf,
  suitOf,
  touchesTerminalNoHonour,
  touchesTerminalOrHonour,
  tripletRanksBySuit,
  windTriplets,
} from './context';

/**
 * The shared vocabulary of scoring patterns.
 *
 * Every ruleset in the app scores the same underlying facts about a hand and
 * disagrees only about which of them count and for how much. So patterns are
 * defined once, here, keyed by a stable id; a ruleset is then just a map from
 * those ids to values. That is what makes user-authored rulesets possible
 * without shipping new code: a custom ruleset picks from this library and sets
 * its own numbers.
 *
 * Ids are permanent. A saved custom ruleset refers to them, so renaming one
 * silently drops that rule from a user's saved configuration.
 */

/**
 * Where a pattern belongs in the editor.
 *
 * Only the editor cares - the scorer treats every pattern the same - but it is
 * the difference between a screen you can find something on and ninety rows in
 * one list. `situational` and `bonus` are what most tables actually argue
 * about; the hand shapes are a long tail behind an expander.
 */
export type PatternGroup =
  | 'situational'
  | 'bonus'
  | 'structural'
  | 'honours'
  | 'suits'
  | 'custom';

export interface PatternDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * Tiles that show what the words are talking about.
   *
   * Only on the patterns whose name *is* a set of tiles. "Dragon" and "wind"
   * are the clearest cases: nothing explains them as fast as the three faces
   * themselves, and a player who has known those tiles their whole life under
   * another name recognises them instantly while the English word means
   * nothing to them.
   */
  readonly tiles?: readonly TileCode[];
  /** Filled in when the list is assembled; individual entries do not set it. */
  readonly group?: PatternGroup;
  /**
   * Patterns whose meaning is entirely contained in this one. When both match,
   * only the superseding pattern scores. Big Three Dragons already implies two
   * Dragon Pungs, and counting both is double-scoring the same three tiles.
   */
  readonly supersedes?: readonly string[];
  /**
   * How many times the pattern applies: 0 for no match, 1 for a plain match,
   * n for patterns that score per occurrence such as dragon triplets or
   * flowers.
   */
  detect(ctx: PatternContext): number;
}

// ---------------------------------------------------------------------------
// Combinatorial helpers
// ---------------------------------------------------------------------------

/** Distinct unordered triples of indices into a list. */
function triples(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1)
      for (let k = j + 1; k < n; k += 1) out.push([i, j, k]);
  return out;
}

function pairsOf(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) out.push([i, j]);
  return out;
}

/** Chows as (suit, startRank) pairs. */
function chowKeys(ctx: PatternContext): { suit: Suit; start: number }[] {
  return ctx.chows.map((c) => ({ suit: suitOf(c.tiles[0]), start: rankOf(c.tiles[0]) }));
}

function numberedTripletKeys(ctx: PatternContext): { suit: Suit; rank: number }[] {
  return ctx.triplets
    .filter((t) => isNumbered(TILE_BY_CODE[t.tiles[0]]))
    .map((t) => ({ suit: suitOf(t.tiles[0]), rank: rankOf(t.tiles[0]) }));
}

function ranksOfAllTiles(ctx: PatternContext): number[] {
  return ctx.tiles.filter((c) => isNumbered(TILE_BY_CODE[c])).map(rankOf);
}

function allNumbered(ctx: PatternContext): boolean {
  return ctx.tiles.every((c) => isNumbered(TILE_BY_CODE[c]));
}

// ---------------------------------------------------------------------------
// Structure: how the melds fit together
// ---------------------------------------------------------------------------

const structural: PatternDefinition[] = [
  {
    id: 'all-chows',
    name: 'All Chows',
    description: 'Every set is a run of three. The pair is not a dragon, and not a wind that would score on its own.',
    detect: (ctx) =>
      ctx.sets.length > 0 &&
      ctx.chows.length === ctx.sets.length &&
      ctx.pair !== null &&
      !isDragonCode(ctx.pair.tiles[0]) &&
      !(isWindCode(ctx.pair.tiles[0]) &&
        (ctx.pair.tiles[0] === ctx.seatWind || ctx.pair.tiles[0] === ctx.roundWind))
        ? 1
        : 0,
  },
  {
    id: 'pinfu',
    name: 'Pinfu',
    description:
      'All runs, a pair worth no bonus, a two-sided wait, and nothing claimed. ' +
      'Named "no points" because it is the one hand that earns no fu at all.',
    detect: (ctx) => {
      if (!ctx.isConcealed) return 0;
      if (ctx.sets.length === 0 || ctx.chows.length !== ctx.sets.length) return 0;
      if (ctx.reading.waitType !== 'open') return 0;
      if (ctx.pair === null) return 0;
      const pairTile = ctx.pair.tiles[0];
      if (isDragonCode(pairTile)) return 0;
      // A seat or round wind pair carries fu, which pinfu forbids. A wind that
      // is neither is fine.
      if (pairTile === ctx.seatWind || pairTile === ctx.roundWind) return 0;
      return 1;
    },
  },
  {
    id: 'all-pungs',
    name: 'All Pungs',
    description: 'Every set is three or four of the same tile. No runs.',
    detect: (ctx) =>
      ctx.sets.length > 0 && ctx.triplets.length === ctx.sets.length && !ctx.reading.special ? 1 : 0,
  },
  {
    id: 'concealed-hand',
    name: 'Concealed Hand',
    description: 'Nothing was claimed from a discard; the hand was won on a discard.',
    detect: (ctx) => (ctx.isConcealed && !ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'fully-concealed-hand',
    name: 'Fully Concealed Hand',
    description: 'Nothing was claimed from a discard, and the winning tile was self-drawn.',
    supersedes: ['concealed-hand'],
    detect: (ctx) => (ctx.isConcealed && ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'melded-hand',
    name: 'Melded Hand',
    description: 'Every set was claimed from a discard, and so was the winning tile.',
    detect: (ctx) => (ctx.allSetsMelded && !ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'two-concealed-pungs',
    name: 'Two Concealed Pungs',
    description: 'Two sets of three of a kind, neither taken from a discard.',
    detect: (ctx) => (ctx.concealedTriplets.length === 2 ? 1 : 0),
  },
  {
    id: 'three-concealed-pungs',
    name: 'Three Concealed Pungs',
    description: 'Three sets of three of a kind, none taken from a discard.',
    supersedes: ['two-concealed-pungs'],
    detect: (ctx) => (ctx.concealedTriplets.length === 3 ? 1 : 0),
  },
  {
    id: 'four-concealed-pungs',
    name: 'Four Concealed Pungs',
    description: 'Four sets of three of a kind, none taken from a discard.',
    supersedes: ['three-concealed-pungs', 'two-concealed-pungs', 'all-pungs'],
    detect: (ctx) => (ctx.concealedTriplets.length === 4 ? 1 : 0),
  },
  {
    id: 'five-concealed-pungs',
    name: 'Five Concealed Pungs',
    description: 'All five sets of a sixteen-tile hand are three of a kind, none taken from a discard.',
    supersedes: ['four-concealed-pungs', 'three-concealed-pungs', 'two-concealed-pungs'],
    detect: (ctx) => (ctx.concealedTriplets.length === 5 ? 1 : 0),
  },
  {
    id: 'concealed-kong',
    name: 'Concealed Kong',
    description: 'Four of the same tile, all drawn rather than claimed. Scores per set of four.',
    detect: (ctx) => ctx.concealedKongs.length,
  },
  {
    id: 'melded-kong',
    name: 'Melded Kong',
    description: 'Four of the same tile, the last one claimed from a discard. Scores per set of four.',
    detect: (ctx) => ctx.meldedKongs.length,
  },
  {
    id: 'two-concealed-kongs',
    name: 'Two Concealed Kongs',
    description: 'Two sets of four, both made without claiming a discard.',
    supersedes: ['concealed-kong'],
    detect: (ctx) => (ctx.concealedKongs.length === 2 ? 1 : 0),
  },
  {
    id: 'two-melded-kongs',
    name: 'Two Melded Kongs',
    description: 'Two sets of four, at least one completed from a discard.',
    detect: (ctx) => (ctx.kongs.length === 2 && ctx.concealedKongs.length < 2 ? 1 : 0),
  },
  {
    id: 'three-kongs',
    name: 'Three Kongs',
    description: 'Three sets of four in one hand.',
    supersedes: ['two-melded-kongs', 'two-concealed-kongs'],
    detect: (ctx) => (ctx.kongs.length === 3 ? 1 : 0),
  },
  {
    id: 'four-kongs',
    name: 'Four Kongs',
    description: 'Four sets of four in one hand.',
    supersedes: ['three-kongs', 'two-melded-kongs', 'two-concealed-kongs', 'all-pungs'],
    detect: (ctx) => (ctx.kongs.length === 4 ? 1 : 0),
  },
  {
    id: 'seven-pairs',
    name: 'Seven Pairs',
    description: 'Seven distinct pairs instead of sets and a pair.',
    detect: (ctx) => (ctx.reading.special === 'seven-pairs' ? 1 : 0),
  },
  {
    id: 'seven-shifted-pairs',
    name: 'Seven Shifted Pairs',
    description: 'Seven pairs in one suit, at seven numbers in a row.',
    supersedes: ['seven-pairs', 'full-flush'],
    detect: (ctx) => {
      if (ctx.reading.special !== 'seven-pairs') return 0;
      const codes = ctx.reading.melds.map((m) => m.tiles[0]);
      if (!codes.every((c) => isNumbered(TILE_BY_CODE[c]))) return 0;
      if (new Set(codes.map(suitOf)).size !== 1) return 0;
      const ranks = codes.map(rankOf).sort((a, b) => a - b);
      return ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1) ? 1 : 0;
    },
  },
  {
    id: 'eight-pairs-triplet',
    name: 'Eight Pairs and a Triplet',
    description: 'The sixteen-tile analogue of seven pairs: eight pairs, one of them tripled.',
    detect: (ctx) => (ctx.reading.special === 'eight-pairs-triplet' ? 1 : 0),
  },
  {
    id: 'thirteen-orphans',
    name: 'Thirteen Orphans',
    description: 'One of every 1, every 9, every wind and every dragon, plus a second copy of any one of them.',
    tiles: ['man1', 'man9', 'pin1', 'pin9', 'sou1', 'sou9', 'east', 'south', 'west', 'north', 'red', 'green', 'white'],
    detect: (ctx) => (ctx.reading.special === 'thirteen-orphans' ? 1 : 0),
  },
  {
    id: 'pure-double-chow',
    name: 'Pure Double Chow',
    description: 'The same run of three, twice, in the same suit.',
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      let count = 0;
      const used = new Set<number>();
      for (const [i, j] of pairsOf(keys.length)) {
        if (used.has(i) || used.has(j)) continue;
        if (keys[i].suit === keys[j].suit && keys[i].start === keys[j].start) {
          count += 1;
          used.add(i);
          used.add(j);
        }
      }
      return count;
    },
  },
  {
    id: 'twice-pure-double-chow',
    name: 'Twice Pure Double Chow',
    description: 'Two separate pairs of identical runs.',
    supersedes: ['pure-double-chow'],
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      let count = 0;
      const used = new Set<number>();
      for (const [i, j] of pairsOf(keys.length)) {
        if (used.has(i) || used.has(j)) continue;
        if (keys[i].suit === keys[j].suit && keys[i].start === keys[j].start) {
          count += 1;
          used.add(i);
          used.add(j);
        }
      }
      return count === 2 ? 1 : 0;
    },
  },
  {
    id: 'mixed-double-chow',
    name: 'Mixed Double Chow',
    description: 'The same three numbers run twice, in two different suits.',
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      let count = 0;
      const used = new Set<number>();
      for (const [i, j] of pairsOf(keys.length)) {
        if (used.has(i) || used.has(j)) continue;
        if (keys[i].suit !== keys[j].suit && keys[i].start === keys[j].start) {
          count += 1;
          used.add(i);
          used.add(j);
        }
      }
      return count;
    },
  },
  {
    id: 'short-straight',
    name: 'Short Straight',
    description: 'Two runs in one suit that carry straight on from each other, like 1-2-3 and 4-5-6.',
    detect: (ctx) => {
      const bySuit = chowStartsBySuit(ctx);
      let count = 0;
      for (const starts of bySuit.values()) {
        const used = new Set<number>();
        for (const [i, j] of pairsOf(starts.length)) {
          if (used.has(i) || used.has(j)) continue;
          if (Math.abs(starts[i] - starts[j]) === 3) {
            count += 1;
            used.add(i);
            used.add(j);
          }
        }
      }
      return count;
    },
  },
  {
    id: 'two-terminal-chows',
    name: 'Two Terminal Chows',
    description: '1-2-3 and 7-8-9, both in the same suit.',
    detect: (ctx) => {
      const bySuit = chowStartsBySuit(ctx);
      let count = 0;
      for (const starts of bySuit.values()) {
        const low = starts.filter((s) => s === 1).length;
        const high = starts.filter((s) => s === 7).length;
        count += Math.min(low, high);
      }
      return count;
    },
  },
  {
    id: 'pure-straight',
    name: 'Pure Straight',
    description: '1 through 9 of one suit, as three runs.',
    detect: (ctx) => {
      const bySuit = chowStartsBySuit(ctx);
      for (const starts of bySuit.values()) {
        if (starts.includes(1) && starts.includes(4) && starts.includes(7)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'mixed-straight',
    name: 'Mixed Straight',
    description: '1-2-3, 4-5-6 and 7-8-9, one run from each of the three suits.',
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        const starts = chosen.map((c) => c.start).sort((a, b) => a - b);
        const suits = new Set(chosen.map((c) => c.suit));
        if (suits.size === 3 && starts[0] === 1 && starts[1] === 4 && starts[2] === 7) return 1;
      }
      return 0;
    },
  },
  {
    id: 'pure-triple-chow',
    name: 'Pure Triple Chow',
    description: 'The same run of three, three times, in one suit.',
    supersedes: ['pure-double-chow', 'twice-pure-double-chow'],
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        if (
          chosen.every((c) => c.suit === chosen[0].suit && c.start === chosen[0].start)
        )
          return 1;
      }
      return 0;
    },
  },
  {
    id: 'mixed-triple-chow',
    name: 'Mixed Triple Chow',
    description: 'The same run of three in all three suits.',
    supersedes: ['mixed-double-chow'],
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        const suits = new Set(chosen.map((c) => c.suit));
        if (suits.size === 3 && chosen.every((c) => c.start === chosen[0].start)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'quadruple-chow',
    name: 'Quadruple Chow',
    description: 'The same run of three, four times, in one suit.',
    supersedes: ['pure-triple-chow', 'pure-double-chow', 'twice-pure-double-chow', 'tile-hog'],
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      const tally = new Map<string, number>();
      for (const key of keys) {
        const id = `${key.suit}${key.start}`;
        tally.set(id, (tally.get(id) ?? 0) + 1);
      }
      return [...tally.values()].some((n) => n >= 4) ? 1 : 0;
    },
  },
  {
    id: 'pure-shifted-chows',
    name: 'Pure Shifted Chows',
    description: 'Three runs in one suit, each starting the same one or two numbers above the last.',
    detect: (ctx) => {
      const bySuit = chowStartsBySuit(ctx);
      for (const starts of bySuit.values()) {
        for (const [i, j, k] of triples(starts.length)) {
          const s = [starts[i], starts[j], starts[k]].sort((a, b) => a - b);
          const d1 = s[1] - s[0];
          const d2 = s[2] - s[1];
          if (d1 === d2 && (d1 === 1 || d1 === 2)) return 1;
        }
      }
      return 0;
    },
  },
  {
    id: 'mixed-shifted-chows',
    name: 'Mixed Shifted Chows',
    description: 'Three runs, one per suit, each starting one number above the last.',
    detect: (ctx) => {
      const keys = chowKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        if (new Set(chosen.map((c) => c.suit)).size !== 3) continue;
        const starts = chosen.map((c) => c.start).sort((a, b) => a - b);
        if (starts[1] === starts[0] + 1 && starts[2] === starts[1] + 1) return 1;
      }
      return 0;
    },
  },
  {
    id: 'four-shifted-chows',
    name: 'Four Shifted Chows',
    description: 'Four runs in one suit, each starting the same one or two numbers above the last.',
    supersedes: ['pure-shifted-chows'],
    detect: (ctx) => {
      const bySuit = chowStartsBySuit(ctx);
      for (const starts of bySuit.values()) {
        if (starts.length < 4) continue;
        const sorted = [...starts].sort((a, b) => a - b);
        for (const step of [1, 2]) {
          for (let i = 0; i + 3 < sorted.length; i += 1) {
            if (
              sorted[i + 1] === sorted[i] + step &&
              sorted[i + 2] === sorted[i] + 2 * step &&
              sorted[i + 3] === sorted[i] + 3 * step
            )
              return 1;
          }
        }
      }
      return 0;
    },
  },
  {
    id: 'triple-pung',
    name: 'Triple Pung',
    description: 'The same number, three of a kind, in all three suits.',
    detect: (ctx) => {
      const keys = numberedTripletKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        if (
          new Set(chosen.map((c) => c.suit)).size === 3 &&
          chosen.every((c) => c.rank === chosen[0].rank)
        )
          return 1;
      }
      return 0;
    },
  },
  {
    id: 'double-pung',
    name: 'Double Pung',
    description: 'The same number, three of a kind, in two of the suits.',
    detect: (ctx) => {
      const keys = numberedTripletKeys(ctx);
      let count = 0;
      const used = new Set<number>();
      for (const [i, j] of pairsOf(keys.length)) {
        if (used.has(i) || used.has(j)) continue;
        if (keys[i].rank === keys[j].rank && keys[i].suit !== keys[j].suit) {
          count += 1;
          used.add(i);
          used.add(j);
        }
      }
      return count;
    },
  },
  {
    id: 'pure-shifted-pungs',
    name: 'Pure Shifted Pungs',
    description: 'Three of a kind at three numbers in a row, all in one suit.',
    detect: (ctx) => {
      const bySuit = tripletRanksBySuit(ctx);
      for (const ranks of bySuit.values()) {
        for (const [i, j, k] of triples(ranks.length)) {
          const s = [ranks[i], ranks[j], ranks[k]].sort((a, b) => a - b);
          if (s[1] === s[0] + 1 && s[2] === s[1] + 1) return 1;
        }
      }
      return 0;
    },
  },
  {
    id: 'four-shifted-pungs',
    name: 'Four Shifted Pungs',
    description: 'Three of a kind at four numbers in a row, all in one suit.',
    supersedes: ['pure-shifted-pungs'],
    detect: (ctx) => {
      const bySuit = tripletRanksBySuit(ctx);
      for (const ranks of bySuit.values()) {
        const sorted = [...ranks].sort((a, b) => a - b);
        for (let i = 0; i + 3 < sorted.length; i += 1) {
          if (
            sorted[i + 1] === sorted[i] + 1 &&
            sorted[i + 2] === sorted[i] + 2 &&
            sorted[i + 3] === sorted[i] + 3
          )
            return 1;
        }
      }
      return 0;
    },
  },
  {
    id: 'mixed-shifted-pungs',
    name: 'Mixed Shifted Pungs',
    description: 'Three of a kind three times, one per suit, each one number above the last.',
    detect: (ctx) => {
      const keys = numberedTripletKeys(ctx);
      for (const [i, j, k] of triples(keys.length)) {
        const chosen = [keys[i], keys[j], keys[k]];
        if (new Set(chosen.map((c) => c.suit)).size !== 3) continue;
        const ranks = chosen.map((c) => c.rank).sort((a, b) => a - b);
        if (ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1) return 1;
      }
      return 0;
    },
  },
  {
    id: 'tile-hog',
    name: 'Tile Hog',
    description: 'All four copies of a tile used in the hand without being set down as a set of four.',
    detect: (ctx) => {
      let count = 0;
      const kongTiles = new Set(ctx.kongs.map((k) => k.tiles[0]));
      for (const [code, n] of ctx.counts) {
        if (n === 4 && !kongTiles.has(code)) count += 1;
      }
      return count;
    },
  },
];

// ---------------------------------------------------------------------------
// Honours: dragons and winds
// ---------------------------------------------------------------------------

const honours: PatternDefinition[] = [
  {
    id: 'dragon-pung',
    name: 'Dragon Pung',
    description: 'Three or four of one dragon. Scores per set.',
    tiles: ['red', 'red', 'red'],
    detect: (ctx) => dragonTriplets(ctx).length,
  },
  {
    id: 'two-dragon-pungs',
    name: 'Two Dragon Pungs',
    description: 'Three of a kind in two different dragons.',
    tiles: ['red', 'red', 'red', 'green', 'green', 'green'],
    supersedes: ['dragon-pung'],
    detect: (ctx) => (dragonTriplets(ctx).length === 2 ? 1 : 0),
  },
  {
    id: 'little-three-dragons',
    name: 'Little Three Dragons',
    description: 'Three of a kind in two dragons, and a pair of the third.',
    tiles: ['red', 'red', 'red', 'green', 'green', 'green', 'white', 'white'],
    supersedes: ['dragon-pung', 'two-dragon-pungs'],
    detect: (ctx) => (dragonTriplets(ctx).length === 2 && pairIsDragon(ctx) ? 1 : 0),
  },
  {
    id: 'big-three-dragons',
    name: 'Big Three Dragons',
    description: 'Three of a kind in every dragon.',
    tiles: ['red', 'red', 'red', 'green', 'green', 'green', 'white', 'white', 'white'],
    supersedes: ['dragon-pung', 'two-dragon-pungs', 'little-three-dragons'],
    detect: (ctx) => (dragonTriplets(ctx).length === 3 ? 1 : 0),
  },
  {
    id: 'seat-wind-pung',
    name: 'Seat Wind',
    description: "Three of a kind in the wind of your own seat.",
    detect: (ctx) => windTriplets(ctx).filter((m) => m.tiles[0] === ctx.seatWind).length,
  },
  {
    id: 'prevalent-wind-pung',
    name: 'Prevalent Wind',
    description: "Three of a kind in the wind the round is named after.",
    detect: (ctx) => windTriplets(ctx).filter((m) => m.tiles[0] === ctx.roundWind).length,
  },
  {
    id: 'wind-pung',
    name: 'Wind Pung',
    description: 'Three of a kind in any wind, whichever seat you are sitting in.',
    tiles: ['east', 'east', 'east'],
    detect: (ctx) => windTriplets(ctx).length,
  },
  {
    id: 'little-three-winds',
    name: 'Little Three Winds',
    description: 'Three of a kind in two winds, and a pair of a third.',
    detect: (ctx) =>
      windTriplets(ctx).length === 2 && ctx.pair !== null && isWindCode(ctx.pair.tiles[0]) ? 1 : 0,
  },
  {
    id: 'big-three-winds',
    name: 'Big Three Winds',
    description: 'Three of a kind in three different winds.',
    tiles: ['east', 'east', 'east', 'south', 'south', 'south', 'west', 'west', 'west'],
    supersedes: ['little-three-winds', 'wind-pung'],
    detect: (ctx) => (windTriplets(ctx).length === 3 ? 1 : 0),
  },
  {
    id: 'little-four-winds',
    name: 'Little Four Winds',
    description: 'Three of a kind in three winds, and a pair of the fourth.',
    tiles: ['east', 'east', 'east', 'south', 'south', 'south', 'west', 'west', 'west', 'north', 'north'],
    supersedes: ['big-three-winds', 'little-three-winds', 'wind-pung', 'seat-wind-pung', 'prevalent-wind-pung'],
    detect: (ctx) =>
      windTriplets(ctx).length === 3 && ctx.pair !== null && isWindCode(ctx.pair.tiles[0]) ? 1 : 0,
  },
  {
    id: 'big-four-winds',
    name: 'Big Four Winds',
    description: 'Three of a kind in every wind.',
    tiles: ['east', 'east', 'east', 'south', 'south', 'south', 'west', 'west', 'west', 'north', 'north', 'north'],
    supersedes: [
      'little-four-winds', 'big-three-winds', 'little-three-winds',
      'wind-pung', 'seat-wind-pung', 'prevalent-wind-pung', 'all-pungs',
    ],
    detect: (ctx) => (windTriplets(ctx).length === 4 ? 1 : 0),
  },
  {
    id: 'all-honours',
    name: 'All Honours',
    description: 'Nothing numbered at all. Only winds and dragons.',
    tiles: ['east', 'south', 'west', 'north', 'red', 'green', 'white'],
    supersedes: ['all-terminals-and-honours', 'half-flush', 'no-simples'],
    detect: (ctx) => (ctx.tiles.every((c) => isHonour(TILE_BY_CODE[c])) ? 1 : 0),
  },
  {
    id: 'pung-of-terminals-or-honours',
    name: 'Pung of Terminals or Honours',
    description: 'Three of a kind in a 1, a 9, a wind or a dragon. Scores per set.',
    tiles: ['man1', 'man1', 'man1'],
    detect: (ctx) => ctx.triplets.filter((t) => isTerminalOrHonourCode(t.tiles[0])).length,
  },
];

// ---------------------------------------------------------------------------
// Suit composition
// ---------------------------------------------------------------------------

const suits: PatternDefinition[] = [
  {
    id: 'full-flush',
    name: 'Full Flush',
    description: 'One suit and nothing else: no winds, no dragons.',
    tiles: ['pin1', 'pin4', 'pin7', 'pin9'],
    supersedes: ['half-flush', 'one-voided-suit', 'no-honours'],
    detect: (ctx) => (allNumbered(ctx) && ctx.numberedSuits.size === 1 ? 1 : 0),
  },
  {
    id: 'half-flush',
    name: 'Half Flush',
    description: 'One suit, plus any winds and dragons.',
    tiles: ['pin1', 'pin4', 'pin7', 'east', 'red'],
    supersedes: ['one-voided-suit'],
    detect: (ctx) => (ctx.numberedSuits.size === 1 && ctx.hasHonours ? 1 : 0),
  },
  {
    id: 'one-voided-suit',
    name: 'One Voided Suit',
    description: 'One of the three suits is missing from the hand entirely.',
    detect: (ctx) => (ctx.numberedSuits.size === 2 ? 1 : 0),
  },
  {
    id: 'no-honours',
    name: 'No Honours',
    description: 'Numbered tiles only. No winds, no dragons.',
    detect: (ctx) => (!ctx.hasHonours ? 1 : 0),
  },
  {
    id: 'all-types',
    name: 'All Types',
    description: 'All three suits, plus at least one wind and at least one dragon.',
    detect: (ctx) => {
      const hasWind = ctx.tiles.some((c) => isWindCode(c));
      const hasDragon = ctx.tiles.some((c) => isDragonCode(c));
      return ctx.numberedSuits.size === 3 && hasWind && hasDragon ? 1 : 0;
    },
  },
  {
    id: 'all-simples',
    name: 'All Simples',
    description: 'Nothing but 2 through 8. No 1s, no 9s, no winds, no dragons.',
    tiles: ['man2', 'pin5', 'sou8'],
    supersedes: ['no-honours'],
    detect: (ctx) => (ctx.tiles.every(isSimpleCode) ? 1 : 0),
  },
  {
    id: 'outside-hand',
    name: 'Outside Hand',
    description: 'Every set and the pair holds a 1, a 9, a wind or a dragon.',
    detect: (ctx) =>
      ctx.reading.melds.length > 0 && ctx.reading.melds.every(touchesTerminalOrHonour) && ctx.hasHonours
        ? 1
        : 0,
  },
  {
    id: 'fully-outside-hand',
    name: 'Fully Outside Hand',
    description: 'Every set and the pair holds a 1 or a 9, and there are no winds or dragons.',
    supersedes: ['outside-hand', 'no-honours'],
    detect: (ctx) =>
      ctx.reading.melds.length > 0 && ctx.reading.melds.every(touchesTerminalNoHonour) ? 1 : 0,
  },
  {
    id: 'all-terminals-and-honours',
    name: 'All Terminals and Honours',
    description: 'Nothing but 1s, 9s, winds and dragons.',
    tiles: ['man1', 'man9', 'pin1', 'pin9', 'east', 'red'],
    supersedes: ['outside-hand', 'all-pungs'],
    detect: (ctx) => (ctx.tiles.every(isTerminalOrHonourCode) && ctx.hasHonours && ctx.hasTerminals ? 1 : 0),
  },
  {
    id: 'all-terminals',
    name: 'All Terminals',
    description: 'Nothing but 1s and 9s.',
    tiles: ['man1', 'man9', 'pin1', 'pin9', 'sou1', 'sou9'],
    supersedes: ['all-terminals-and-honours', 'fully-outside-hand', 'outside-hand', 'no-honours', 'all-pungs'],
    detect: (ctx) =>
      ctx.tiles.every((c) => isNumbered(TILE_BY_CODE[c]) && isTerminal(TILE_BY_CODE[c])) ? 1 : 0,
  },
  {
    id: 'all-green',
    name: 'All Green',
    description: 'Only tiles that are entirely green: 2, 3, 4, 6 and 8 of bamboo, and the green dragon.',
    tiles: ['sou2', 'sou3', 'sou4', 'sou6', 'sou8', 'green'],
    detect: (ctx) => {
      const green = new Set<TileCode>(['sou2', 'sou3', 'sou4', 'sou6', 'sou8', 'green']);
      return ctx.tiles.every((c) => green.has(c)) ? 1 : 0;
    },
  },
  {
    id: 'nine-gates',
    name: 'Nine Gates',
    description: '1112345678999 in one suit, plus any one more tile of that suit.',
    detect: (ctx) => {
      if (!ctx.isConcealed || !allNumbered(ctx) || ctx.numberedSuits.size !== 1) return 0;
      const ranks = new Array(10).fill(0) as number[];
      for (const code of ctx.tiles) ranks[rankOf(code)] += 1;
      const required = [0, 3, 1, 1, 1, 1, 1, 1, 1, 3];
      let extra = 0;
      for (let r = 1; r <= 9; r += 1) {
        const diff = ranks[r] - required[r];
        if (diff < 0) return 0;
        extra += diff;
      }
      return extra === 1 ? 1 : 0;
    },
  },
  {
    id: 'upper-tiles',
    name: 'Upper Tiles',
    description: 'Every tile is a seven, eight or nine.',
    detect: (ctx) => (allNumbered(ctx) && ranksOfAllTiles(ctx).every((r) => r >= 7) ? 1 : 0),
  },
  {
    id: 'middle-tiles',
    name: 'Middle Tiles',
    description: 'Every tile is a four, five or six.',
    supersedes: ['all-simples'],
    detect: (ctx) => (allNumbered(ctx) && ranksOfAllTiles(ctx).every((r) => r >= 4 && r <= 6) ? 1 : 0),
  },
  {
    id: 'lower-tiles',
    name: 'Lower Tiles',
    description: 'Every tile is a one, two or three.',
    detect: (ctx) => (allNumbered(ctx) && ranksOfAllTiles(ctx).every((r) => r <= 3) ? 1 : 0),
  },
  {
    id: 'upper-four',
    name: 'Upper Four',
    description: 'Every tile is a six or higher.',
    detect: (ctx) => (allNumbered(ctx) && ranksOfAllTiles(ctx).every((r) => r >= 6) ? 1 : 0),
  },
  {
    id: 'lower-four',
    name: 'Lower Four',
    description: 'Every tile is a four or lower.',
    detect: (ctx) => (allNumbered(ctx) && ranksOfAllTiles(ctx).every((r) => r <= 4) ? 1 : 0),
  },
  {
    id: 'all-fives',
    name: 'All Fives',
    description: 'Every set and the pair contains a five.',
    supersedes: ['all-simples'],
    detect: (ctx) =>
      ctx.reading.melds.length > 0 &&
      ctx.reading.melds.every((m) => m.tiles.some((c) => isNumbered(TILE_BY_CODE[c]) && rankOf(c) === 5))
        ? 1
        : 0,
  },
  {
    id: 'all-even-pungs',
    name: 'All Even Pungs',
    description: 'Three of a kind only, and every one of them an even number.',
    supersedes: ['all-pungs', 'all-simples'],
    detect: (ctx) =>
      ctx.sets.length > 0 &&
      ctx.triplets.length === ctx.sets.length &&
      allNumbered(ctx) &&
      ranksOfAllTiles(ctx).every((r) => r % 2 === 0)
        ? 1
        : 0,
  },
  {
    id: 'reversible-tiles',
    name: 'Reversible Tiles',
    description: 'Only tiles whose faces are symmetrical under rotation.',
    detect: (ctx) => {
      const reversible = new Set<TileCode>([
        'pin1', 'pin2', 'pin3', 'pin4', 'pin5', 'pin8', 'pin9',
        'sou2', 'sou4', 'sou5', 'sou6', 'sou8', 'sou9', 'white',
      ]);
      return ctx.tiles.every((c) => reversible.has(c)) ? 1 : 0;
    },
  },
  {
    id: 'pure-terminal-chows',
    name: 'Pure Terminal Chows',
    description: '1-2-3 twice, 7-8-9 twice, and a pair of 5s, all in one suit.',
    supersedes: ['full-flush', 'pure-double-chow', 'twice-pure-double-chow', 'two-terminal-chows'],
    detect: (ctx) => {
      if (ctx.numberedSuits.size !== 1 || !allNumbered(ctx)) return 0;
      const starts = ctx.chows.map((c) => rankOf(c.tiles[0])).sort((a, b) => a - b);
      const pairRank = ctx.pair ? rankOf(ctx.pair.tiles[0]) : 0;
      return starts.length === 4 &&
        starts[0] === 1 && starts[1] === 1 && starts[2] === 7 && starts[3] === 7 && pairRank === 5
        ? 1
        : 0;
    },
  },
  {
    id: 'three-suited-terminal-chows',
    name: 'Three Suited Terminal Chows',
    description: '1-2-3 and 7-8-9 in two suits, and a pair of 5s in the third.',
    detect: (ctx) => {
      if (ctx.hasHonours || ctx.pair === null) return 0;
      if (rankOf(ctx.pair.tiles[0]) !== 5) return 0;
      const pairSuit = suitOf(ctx.pair.tiles[0]);
      const bySuit = chowStartsBySuit(ctx);
      const others = NUMBERED.filter((s) => s !== pairSuit);
      return others.every((s) => {
        const starts = bySuit.get(s) ?? [];
        return starts.includes(1) && starts.includes(7);
      })
        ? 1
        : 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Situational: how and when the hand was won
// ---------------------------------------------------------------------------

const situational: PatternDefinition[] = [
  {
    id: 'self-drawn',
    name: 'Self Drawn',
    description: 'The winning tile came from the wall rather than a discard.',
    detect: (ctx) => (ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'last-tile-draw',
    name: 'Last Tile Draw',
    description: 'Won by self-drawing the final tile of the wall.',
    detect: (ctx) => (ctx.hand.context.lastTileFromWall && ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'last-tile-claim',
    name: 'Last Tile Claim',
    description: 'Won on the last discard of the hand.',
    detect: (ctx) => (ctx.hand.context.lastDiscard && !ctx.selfDrawn ? 1 : 0),
  },
  {
    id: 'out-with-replacement-tile',
    name: 'Out with Replacement Tile',
    description: 'Won on the tile drawn to replace a set of four.',
    detect: (ctx) => (ctx.hand.context.afterKong ? 1 : 0),
  },
  {
    id: 'robbing-the-kong',
    name: 'Robbing the Kong',
    description: 'Won by taking the tile another player was adding to their three of a kind.',
    detect: (ctx) => (ctx.hand.context.robbingKong ? 1 : 0),
  },
  {
    id: 'last-tile',
    name: 'Last Tile',
    description: 'The winning tile was the last of its kind, the other three being visible.',
    detect: (ctx) => (ctx.hand.context.lastTileOfKind ? 1 : 0),
  },
  {
    id: 'edge-wait',
    name: 'Edge Wait',
    description: 'Won on the only tile that could complete 1-2 or 8-9.',
    detect: (ctx) => (ctx.reading.waitType === 'edge' ? 1 : 0),
  },
  {
    id: 'closed-wait',
    name: 'Closed Wait',
    description: 'Won on the middle tile of a run.',
    detect: (ctx) => (ctx.reading.waitType === 'closed' ? 1 : 0),
  },
  {
    id: 'single-wait',
    name: 'Single Wait',
    description: 'Won on the tile that completed the pair.',
    detect: (ctx) => (ctx.reading.waitType === 'single' ? 1 : 0),
  },
  {
    id: 'riichi',
    name: 'Riichi',
    description: 'Declared one tile away from winning, having claimed nothing from a discard.',
    detect: (ctx) => (ctx.hand.context.riichi && !ctx.hand.context.doubleRiichi ? 1 : 0),
  },
  {
    id: 'double-riichi',
    name: 'Double Riichi',
    description: 'Riichi declared on the first discard of the hand.',
    supersedes: ['riichi'],
    detect: (ctx) => (ctx.hand.context.doubleRiichi ? 1 : 0),
  },
  {
    id: 'ippatsu',
    name: 'Ippatsu',
    description: 'Won within one go-around of declaring riichi.',
    detect: (ctx) =>
      ctx.hand.context.ippatsu && (ctx.hand.context.riichi || ctx.hand.context.doubleRiichi) ? 1 : 0,
  },
  {
    id: 'heavenly-hand',
    name: 'Blessing of Heaven',
    description: 'The dealer wins on the tiles as dealt.',
    detect: (ctx) => (ctx.hand.context.heavenly && ctx.hand.context.isDealer ? 1 : 0),
  },
  {
    id: 'earthly-hand',
    name: 'Blessing of Earth',
    description: "A non-dealer wins on the dealer's first discard.",
    detect: (ctx) => (ctx.hand.context.earthly && !ctx.hand.context.isDealer ? 1 : 0),
  },
  {
    id: 'chicken-hand',
    name: 'Chicken Hand',
    description: 'A legal hand that scores nothing else at all.',
    // Evaluated by the scorer after every other pattern, which is the only
    // way to know that nothing else matched.
    detect: () => 0,
  },
  {
    id: 'flower-tiles',
    name: 'Flower Tiles',
    description: 'Each flower or season set aside. Scores per tile.',
    detect: (ctx) => ctx.bonus.filter((c) => isBonus(TILE_BY_CODE[c])).length,
  },
  {
    id: 'seat-flower',
    name: 'Seat Flower',
    description: "The flower matching the player's seat wind.",
    detect: (ctx) => {
      const seatIndex = ['east', 'south', 'west', 'north'].indexOf(ctx.seatWind) + 1;
      return ctx.bonus.filter(
        (c) => TILE_BY_CODE[c].suit === 'flower' && TILE_BY_CODE[c].rank === seatIndex,
      ).length;
    },
  },
  {
    id: 'seat-season',
    name: 'Seat Season',
    description: "The season matching the player's seat wind.",
    detect: (ctx) => {
      const seatIndex = ['east', 'south', 'west', 'north'].indexOf(ctx.seatWind) + 1;
      return ctx.bonus.filter(
        (c) => TILE_BY_CODE[c].suit === 'season' && TILE_BY_CODE[c].rank === seatIndex,
      ).length;
    },
  },
  {
    id: 'all-flowers',
    name: 'All Flowers',
    description: 'All four flower tiles.',
    supersedes: ['seat-flower'],
    detect: (ctx) => (ctx.bonus.filter((c) => TILE_BY_CODE[c].suit === 'flower').length === 4 ? 1 : 0),
  },
  {
    id: 'all-seasons',
    name: 'All Seasons',
    description: 'All four season tiles.',
    supersedes: ['seat-season'],
    detect: (ctx) => (ctx.bonus.filter((c) => TILE_BY_CODE[c].suit === 'season').length === 4 ? 1 : 0),
  },
  {
    id: 'all-eight-bonus',
    name: 'All Eight Flowers and Seasons',
    description: 'Every bonus tile in the set.',
    supersedes: ['all-flowers', 'all-seasons', 'flower-tiles', 'seat-flower', 'seat-season'],
    detect: (ctx) => (ctx.bonus.length === 8 ? 1 : 0),
  },
  {
    id: 'no-flowers',
    name: 'No Flowers or Seasons',
    description: 'The hand was completed without drawing a single bonus tile.',
    detect: (ctx) => (ctx.bonus.length === 0 ? 1 : 0),
  },
  {
    id: 'ready-on-deal',
    name: 'Ready on the Original Hand',
    description: 'The hand was one tile from winning before the first draw.',
    detect: (ctx) => (ctx.hand.context.readyOnDeal ? 1 : 0),
  },
  {
    id: 'early-win-nine',
    name: 'Early Win',
    description: 'Won within the first nine discards of the hand.',
    detect: (ctx) => {
      const discards = ctx.hand.context.discardsBeforeWin;
      return discards !== undefined && discards >= 6 && discards <= 9 ? 1 : 0;
    },
  },
  {
    id: 'early-win-five',
    name: 'Very Early Win',
    description: 'Won within the first five discards of the hand.',
    supersedes: ['early-win-nine'],
    detect: (ctx) => {
      const discards = ctx.hand.context.discardsBeforeWin;
      return discards !== undefined && discards <= 5 ? 1 : 0;
    },
  },
  {
    id: 'winning-hand',
    name: 'Winning the Hand',
    description: 'A flat bonus for completing a hand at all.',
    detect: () => 1,
  },
];

/**
 * Patterns that score bonus tiles rather than the hand.
 *
 * They sit among the situational ones in source order because that is where
 * they were written, but they are the first thing a table changes - whether a
 * flower pays regardless of seat is the single most common house rule - so the
 * editor gives them their own section.
 */
const BONUS_IDS = new Set([
  'flower-tiles',
  'seat-flower',
  'seat-season',
  'all-flowers',
  'all-seasons',
  'all-eight-bonus',
  'no-flowers',
]);

/**
 * Patterns about the *circumstances* of a win rather than the shape of a hand.
 *
 * They are defined among the structural ones because that is where a hand's
 * concealment naturally sits when you are writing detectors. In the editor it
 * is the wrong place: "was anything claimed" is the same kind of question as
 * "was it self-drawn", and a table arguing about what a concealed hand is
 * worth should not have to go looking for it under hand shapes.
 */
const SITUATIONAL_IDS = new Set([
  'concealed-hand',
  'fully-concealed-hand',
  'melded-hand',
  'ready-on-deal',
  'early-win-nine',
  'early-win-five',
  'winning-hand',
  'chicken-hand',
]);

function groupOf(id: string, fallback: PatternGroup): PatternGroup {
  if (BONUS_IDS.has(id)) return 'bonus';
  if (SITUATIONAL_IDS.has(id)) return 'situational';
  return fallback;
}

function grouped(list: PatternDefinition[], group: PatternGroup): PatternDefinition[] {
  return list.map((pattern) => ({ ...pattern, group: groupOf(pattern.id, group) }));
}

export const PATTERN_LIST: readonly PatternDefinition[] = [
  ...grouped(situational, 'situational'),
  ...grouped(structural, 'structural'),
  ...grouped(honours, 'honours'),
  ...grouped(suits, 'suits'),
];

export const PATTERNS: ReadonlyMap<string, PatternDefinition> = new Map(
  PATTERN_LIST.map((p) => [p.id, p]),
);

export function patternById(id: string): PatternDefinition | undefined {
  return PATTERNS.get(id);
}
