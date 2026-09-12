import type { TileCode } from '@/tiles/tileset';
import type { HandInput } from './hand';
import { buildContext } from './patterns/context';
import { evidenceFor } from './patterns/evidence';
import type { RuleSet } from './rulesets/types';
import type { ScoreResult, ScoredPattern } from './score';

/**
 * What a scored hand was worth, line by line - the sheet that opens when a
 * hand is tapped.
 *
 * The lists of pattern names that used to sit under every hand said *what*
 * scored and not *how much*, and they crowded out the tiles themselves. This
 * says both, in the ruleset's own unit, and shows the tiles behind each line
 * where there are particular tiles to show (`evidenceFor`).
 */

export interface BreakdownLine {
  readonly id: string;
  readonly name: string;
  /** '+3 faan', '×2 · +2 faan', 'Limit'. */
  readonly amount: string;
  /** The sets that earned it, or null where it is about the hand as a whole. */
  readonly tiles: TileCode[][] | null;
}

export interface Breakdown {
  readonly lines: BreakdownLine[];
  /** '10 faan · Limit hand' - the same words as the hand's row. */
  readonly total: string;
  /** Why the total is not the sum of the lines, when it is not. */
  readonly note?: string;
}

/**
 * A score as one short phrase: the number, then what capped or named it.
 *
 * Number first, always. "Limit hand" on its own said the hand was big without
 * saying how big, and a limit hand's number is what it is paid as - the top of
 * the table - rather than the few faan it happened to add up to on the way.
 */
export function scoreText(total: number, unit: string, limitName?: string | null): string {
  const base = `${total} ${unit}`;
  return limitName ? `${base} · ${limitName}` : base;
}

function amountOf(pattern: ScoredPattern, unit: string): string {
  if (pattern.isLimit) return unit === 'han' ? 'Yakuman' : 'Limit';
  const value = `+${pattern.total} ${unit}`;
  return pattern.count > 1 ? `×${pattern.count} · ${value}` : value;
}

/**
 * Why a total differs from what its lines add up to.
 *
 * Only for the cases where it does, because a note under every hand would be
 * read by nobody. A limit hand pays as the top of the table whatever its other
 * patterns sum to; a Taiwanese cap stops paying past a number of tai.
 */
function noteFor(result: ScoreResult): string | undefined {
  if (!result.limitName) return undefined;
  if (result.limitName === 'Limit hand') {
    return `A limit hand pays the top of the table - the same as ${result.total} ${result.unit} - whatever the rest of it adds up to.`;
  }
  if (result.limitName.startsWith('Capped')) {
    return `This table stops paying past a certain number of tai. ${result.limitName}.`;
  }
  return undefined;
}

/**
 * Every line of a scored hand, with the tiles behind each where there are any.
 *
 * Takes the result rather than scoring again, so the lines are exactly the
 * reading the total came from. Dora is the one contribution with no pattern of
 * its own - it is a count the player reports - so it gets a line here.
 */
export function breakdownOf(result: ScoreResult, hand: HandInput, rules: RuleSet): Breakdown {
  const ctx = result.reading ? buildContext(hand, result.reading, rules.handSize) : null;
  const lines: BreakdownLine[] = result.patterns.map((pattern) => ({
    id: pattern.id,
    name: pattern.name,
    amount: amountOf(pattern, result.unit),
    tiles: ctx ? evidenceFor(pattern.id, ctx) : null,
  }));
  const dora = hand.context.dora ?? 0;
  if (result.unit === 'han' && dora > 0 && !result.patterns.some((p) => p.isLimit)) {
    lines.push({ id: 'dora', name: 'Dora', amount: `+${dora} han`, tiles: null });
  }
  return {
    lines,
    total: scoreText(result.total, result.unit, result.limitName),
    note: noteFor(result),
  };
}
