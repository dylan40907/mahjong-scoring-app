import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isHonour, isNumbered, isTerminal, isTerminalOrHonour } from '@/tiles/tileset';
import type { PatternContext } from './context';
import { isDragonCode, isWindCode } from './context';
import type { PatternDefinition } from './library';

/**
 * Hands a table made up, described rather than coded.
 *
 * Every group has a hand or two nobody else plays, and the honest position for
 * this app is that the pattern library will never be complete. What it can do
 * is expose the vocabulary the built-in patterns are written in - how many
 * sets of what kind, which suits, what the pair is, how it was won - and let
 * someone assemble their own out of the same parts.
 *
 * A requirement is a claim about the hand; a custom hand is a list of them and
 * scores when every one holds. That is deliberately weaker than the built-in
 * detectors, which are arbitrary code: no requirement can look at two things
 * at once, so "three concealed pungs of the same suit" is two requirements
 * that happen to both be true rather than one that means it. In exchange the
 * whole thing is editable with steppers and segmented controls, serialises to
 * plain JSON, and cannot make the scorer throw.
 *
 * Ids are namespaced under `custom:` so a user-authored hand can never collide
 * with a library id, which matters because the library's ids are permanent and
 * a ruleset references them by string.
 */

export const CUSTOM_HAND_PREFIX = 'custom:';

export type SetKind = 'chow' | 'pung' | 'kong' | 'concealed-set' | 'set';

export type SuitRule =
  | 'single-suit'
  | 'single-suit-plus-honours'
  | 'no-honours'
  | 'honours-only'
  | 'all-three-suits';

export type TileFamily = 'terminal-or-honour' | 'terminal' | 'simple' | 'honour' | 'green';

export type PairRule = 'dragon' | 'wind' | 'seat-wind' | 'round-wind' | 'terminal' | 'simple';

export type HandRequirement =
  /** How many sets of a kind the hand holds. */
  | { readonly kind: 'sets'; readonly of: SetKind; readonly atLeast: number; readonly exactly?: boolean }
  /** How many pairs, for seven-pairs-shaped hands. */
  | { readonly kind: 'pairs'; readonly count: number }
  | { readonly kind: 'suits'; readonly rule: SuitRule }
  /** Every tile in the hand is of this family, or none of them is. */
  | { readonly kind: 'tiles'; readonly family: TileFamily; readonly scope: 'every' | 'none' }
  /** Triplets (or kongs) of these particular tiles. */
  | { readonly kind: 'triplet-of'; readonly tiles: readonly TileCode[]; readonly mode: 'all' | 'any' }
  /** The hand simply contains these tiles somewhere. */
  | { readonly kind: 'contains'; readonly tiles: readonly TileCode[] }
  | { readonly kind: 'pair-is'; readonly rule: PairRule }
  | { readonly kind: 'won'; readonly how: 'self-drawn' | 'discard' };

export interface CustomHand {
  /** Always prefixed `custom:`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** All of these must hold. An empty list never scores, rather than always. */
  readonly requirements: readonly HandRequirement[];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const GREEN_TILES = new Set<TileCode>(['sou2', 'sou3', 'sou4', 'sou6', 'sou8', 'green']);

function inFamily(code: TileCode, family: TileFamily): boolean {
  const tile = TILE_BY_CODE[code];
  switch (family) {
    case 'terminal-or-honour':
      return isTerminalOrHonour(tile);
    case 'terminal':
      return isNumbered(tile) && isTerminal(tile);
    case 'simple':
      return isNumbered(tile) && tile.rank >= 2 && tile.rank <= 8;
    case 'honour':
      return isHonour(tile);
    case 'green':
      return GREEN_TILES.has(code);
  }
}

function countSets(ctx: PatternContext, of: SetKind): number {
  switch (of) {
    case 'chow':
      return ctx.chows.length;
    case 'pung':
      // A kong is a triplet with a spare tile, and every ruleset here counts it
      // as one wherever "three triplets" is the requirement.
      return ctx.triplets.length;
    case 'kong':
      return ctx.kongs.length;
    case 'concealed-set':
      return ctx.sets.filter((meld) => meld.concealed).length;
    case 'set':
      return ctx.sets.length;
  }
}

function pairRuleHolds(ctx: PatternContext, rule: PairRule): boolean {
  const pair = ctx.pair;
  if (!pair) return false;
  const code = pair.tiles[0];
  switch (rule) {
    case 'dragon':
      return isDragonCode(code);
    case 'wind':
      return isWindCode(code);
    case 'seat-wind':
      return code === ctx.seatWind;
    case 'round-wind':
      return code === ctx.roundWind;
    case 'terminal':
      return inFamily(code, 'terminal');
    case 'simple':
      return inFamily(code, 'simple');
  }
}

function suitRuleHolds(ctx: PatternContext, rule: SuitRule): boolean {
  switch (rule) {
    case 'single-suit':
      return ctx.numberedSuits.size === 1 && !ctx.hasHonours;
    case 'single-suit-plus-honours':
      return ctx.numberedSuits.size === 1 && ctx.hasHonours;
    case 'no-honours':
      return !ctx.hasHonours;
    case 'honours-only':
      return ctx.numberedSuits.size === 0;
    case 'all-three-suits':
      return ctx.numberedSuits.size === 3;
  }
}

function requirementHolds(requirement: HandRequirement, ctx: PatternContext): boolean {
  switch (requirement.kind) {
    case 'sets': {
      const have = countSets(ctx, requirement.of);
      return requirement.exactly ? have === requirement.atLeast : have >= requirement.atLeast;
    }
    case 'pairs':
      return ctx.reading.melds.filter((meld) => meld.kind === 'pair').length === requirement.count;
    case 'suits':
      return suitRuleHolds(ctx, requirement.rule);
    case 'tiles': {
      if (ctx.tiles.length === 0) return false;
      const test = (code: TileCode) => inFamily(code, requirement.family);
      return requirement.scope === 'every' ? ctx.tiles.every(test) : !ctx.tiles.some(test);
    }
    case 'triplet-of': {
      const heads = new Set(ctx.triplets.map((meld) => meld.tiles[0]));
      return requirement.mode === 'all'
        ? requirement.tiles.every((code) => heads.has(code))
        : requirement.tiles.some((code) => heads.has(code));
    }
    case 'contains': {
      // Counted rather than tested, so "two red dragons" needs two of them.
      const needed = new Map<TileCode, number>();
      for (const code of requirement.tiles) needed.set(code, (needed.get(code) ?? 0) + 1);
      for (const [code, n] of needed) if ((ctx.counts.get(code) ?? 0) < n) return false;
      return true;
    }
    case 'pair-is':
      return pairRuleHolds(ctx, requirement.rule);
    case 'won':
      return requirement.how === 'self-drawn' ? ctx.selfDrawn : !ctx.selfDrawn;
  }
}

/** Whether a hand as read satisfies every requirement. */
export function matchesCustomHand(hand: CustomHand, ctx: PatternContext): boolean {
  // An empty list is a hand nobody finished describing. Scoring it on every
  // win would be the most expensive possible way to be wrong.
  if (hand.requirements.length === 0) return false;
  return hand.requirements.every((requirement) => requirementHolds(requirement, ctx));
}

/** Present a custom hand to the scorer the way a built-in pattern is. */
export function toPatternDefinition(hand: CustomHand): PatternDefinition {
  return {
    id: hand.id,
    name: hand.name,
    description: hand.description,
    group: 'custom',
    detect: (ctx) => (matchesCustomHand(hand, ctx) ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// Describing one in words
// ---------------------------------------------------------------------------

const SET_LABEL: Record<SetKind, string> = {
  chow: 'runs',
  pung: 'triplets',
  kong: 'kongs',
  'concealed-set': 'concealed sets',
  set: 'sets',
};

const SUIT_LABEL: Record<SuitRule, string> = {
  'single-suit': 'one suit only, no honours',
  'single-suit-plus-honours': 'one suit plus honours',
  'no-honours': 'no honours',
  'honours-only': 'honours only',
  'all-three-suits': 'all three suits',
};

const FAMILY_LABEL: Record<TileFamily, string> = {
  'terminal-or-honour': 'a terminal or honour',
  terminal: 'a terminal',
  simple: 'a simple',
  honour: 'an honour',
  green: 'green',
};

const PAIR_LABEL: Record<PairRule, string> = {
  dragon: 'a dragon',
  wind: 'a wind',
  'seat-wind': 'the seat wind',
  'round-wind': 'the round wind',
  terminal: 'a terminal',
  simple: 'a simple',
};

/** One requirement as a line of English, for the editor and the detail screen. */
export function describeRequirement(requirement: HandRequirement): string {
  switch (requirement.kind) {
    case 'sets':
      return `${requirement.exactly ? 'Exactly' : 'At least'} ${requirement.atLeast} ${SET_LABEL[requirement.of]}`;
    case 'pairs':
      return `${requirement.count} pairs and nothing else`;
    case 'suits':
      return SUIT_LABEL[requirement.rule].replace(/^./, (c) => c.toUpperCase());
    case 'tiles':
      return requirement.scope === 'every'
        ? `Every tile is ${FAMILY_LABEL[requirement.family]}`
        : `No tile is ${FAMILY_LABEL[requirement.family]}`;
    case 'triplet-of': {
      const names = requirement.tiles.map((code) => TILE_BY_CODE[code].label);
      if (names.length === 0) return 'A triplet of — nothing chosen yet';
      return `A triplet of ${requirement.mode === 'all' ? 'each of' : 'any of'} ${names.join(', ')}`;
    }
    case 'contains': {
      const names = requirement.tiles.map((code) => TILE_BY_CODE[code].label);
      return names.length === 0 ? 'Contains — nothing chosen yet' : `Contains ${names.join(', ')}`;
    }
    case 'pair-is':
      return `The pair is ${PAIR_LABEL[requirement.rule]}`;
    case 'won':
      return requirement.how === 'self-drawn' ? 'Won by self-draw' : "Won on someone's discard";
  }
}

/** A whole custom hand as a sentence, used where there is no room for a list. */
export function describeCustomHand(hand: CustomHand): string {
  if (hand.requirements.length === 0) return 'No requirements yet — this hand will never score.';
  return hand.requirements.map(describeRequirement).join(' · ');
}

export function isCustomHandId(id: string): boolean {
  return id.startsWith(CUSTOM_HAND_PREFIX);
}
