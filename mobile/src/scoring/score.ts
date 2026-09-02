import { decompose } from './decompose';
import type { Decomposition, HandInput } from './hand';
import { buildContext } from './patterns/context';
import { PATTERNS, type PatternDefinition } from './patterns/library';
import { toPatternDefinition } from './patterns/custom';
import {
  faanToPoints,
  isFaan,
  isMcr,
  isRiichi,
  isTai,
  limitPoints,
  riichiBasePoints,
  settleFaan,
  settleMcr,
  settleRiichi,
  settleTai,
  type Settlement,
} from './payout';
import { computeFu, type FuBreakdown } from './payout/fu';
import type { PatternValue, RuleSet } from './rulesets/types';

/**
 * Score one winning hand against one ruleset.
 *
 * The work is: read the hand every way it can be read, score each reading, and
 * keep the best. Everything ruleset-specific is either a number in the ruleset
 * or a branch in the payout module; this file only knows the shape of the
 * procedure.
 */

export type ScoringUnit = 'tai' | 'faan' | 'han' | 'points';

export interface ScoredPattern {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** How many times it applied - dragon triplets and flowers can repeat. */
  readonly count: number;
  /** The value of a single occurrence under this ruleset. */
  readonly unitValue: number;
  readonly total: number;
  /** True when this pattern makes the hand a limit hand. */
  readonly isLimit: boolean;
}

export interface ScoreResult {
  readonly valid: boolean;
  /** Present when `valid` is false: why the hand cannot be scored. */
  readonly reason?: string;
  readonly ruleSetId: string;
  readonly ruleSetName: string;
  readonly reading: Decomposition | null;
  readonly patterns: readonly ScoredPattern[];
  /** The total in the ruleset's own counting unit. */
  readonly total: number;
  readonly unit: ScoringUnit;
  /** Riichi only. */
  readonly fu?: FuBreakdown;
  /** 'Mangan', 'Limit hand', … when a ceiling applied. */
  readonly limitName?: string;
  readonly settlement: Settlement | null;
}

/** Patterns that score bonus tiles; excluded from minimum-hand-value checks. */
const BONUS_PATTERN_IDS = new Set([
  'flower-tiles',
  'seat-flower',
  'seat-season',
  'all-flowers',
  'all-seasons',
  'all-eight-bonus',
  'no-flowers',
]);

interface Match {
  readonly definition: PatternDefinition;
  readonly rule: PatternValue;
  readonly count: number;
}

/**
 * The patterns this ruleset can match: the library, plus its own hands.
 *
 * Built per call rather than cached. A ruleset is edited far more often than a
 * hand is scored, and a stale cache here would silently score the previous
 * version of a hand somebody had just corrected.
 */
export function patternsFor(rules: RuleSet): ReadonlyMap<string, PatternDefinition> {
  if (!rules.customHands?.length) return PATTERNS;
  const map = new Map(PATTERNS);
  for (const hand of rules.customHands) map.set(hand.id, toPatternDefinition(hand));
  return map;
}

function collectMatches(
  reading: Decomposition,
  hand: HandInput,
  rules: RuleSet,
): Match[] {
  const ctx = buildContext(hand, reading, rules.handSize);
  const matches: Match[] = [];
  const library = patternsFor(rules);

  for (const [id, rule] of Object.entries(rules.patterns)) {
    const definition = library.get(id);
    if (!definition) continue;
    if (rule.concealedOnly && !ctx.isConcealed) continue;
    const count = definition.detect(ctx);
    if (count <= 0) continue;
    matches.push({ definition, rule, count });
  }

  // The non-repeat principle: a pattern that fully contains another scores
  // instead of it, not alongside it. Big Three Dragons is not also two Dragon
  // Pungs; Four Concealed Pungs is not also All Pungs.
  const absorbed = new Set<string>();
  for (const match of matches) {
    for (const id of match.definition.supersedes ?? []) absorbed.add(id);
  }
  return matches.filter((m) => !absorbed.has(m.definition.id));
}

function valueFor(match: Match, isConcealed: boolean): number {
  if (!isConcealed && match.rule.openValue !== undefined) return match.rule.openValue;
  return match.rule.value;
}

function toScoredPatterns(matches: Match[], isConcealed: boolean): ScoredPattern[] {
  return matches
    .map((match) => {
      const unitValue = valueFor(match, isConcealed);
      return {
        id: match.definition.id,
        name: match.definition.name,
        description: match.definition.description,
        count: match.count,
        unitValue,
        total: unitValue * match.count,
        isLimit: match.rule.limit !== undefined,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function scoreReading(reading: Decomposition, hand: HandInput, rules: RuleSet): ScoreResult {
  const ctx = buildContext(hand, reading, rules.handSize);
  let matches = collectMatches(reading, hand, rules);

  // MCR's Chicken Hand exists precisely to reward a hand that matched nothing
  // else, so it can only be decided once everything else has been evaluated.
  const chickenRule = rules.patterns['chicken-hand'];
  if (chickenRule) {
    const scoringTotal = matches
      .filter((m) => !BONUS_PATTERN_IDS.has(m.definition.id))
      .reduce((sum, m) => sum + valueFor(m, ctx.isConcealed) * m.count, 0);
    if (scoringTotal === 0) {
      const definition = PATTERNS.get('chicken-hand');
      if (definition) matches = [...matches, { definition, rule: chickenRule, count: 1 }];
    }
  }

  const limitMatch = matches.find((m) => m.rule.limit !== undefined);
  const patterns = toScoredPatterns(matches, ctx.isConcealed);
  const base = {
    ruleSetId: rules.id,
    ruleSetName: rules.name,
    reading,
    patterns,
  };

  if (rules.requiresYaku && matches.length === 0) {
    return {
      ...base,
      valid: false,
      reason: 'No yaku: this hand is complete but cannot be declared.',
      total: 0,
      unit: 'han',
      settlement: null,
    };
  }

  const payout = rules.payout;

  // ---- Riichi -----------------------------------------------------------
  if (isRiichi(payout)) {
    if (limitMatch) {
      const limits = matches
        .filter((m) => m.rule.limit !== undefined)
        .reduce((sum, m) => sum + (m.rule.limit ?? 0), 0);
      const score = { fu: 0, han: 13 * limits, basePoints: 8000 * limits, limitName: 'Yakuman' };
      return {
        ...base,
        valid: true,
        total: score.han,
        unit: 'han',
        limitName: limits > 1 ? `Double Yakuman` : 'Yakuman',
        settlement: settleRiichi(payout, score, hand.context),
      };
    }

    const han =
      matches.reduce((sum, m) => sum + valueFor(m, ctx.isConcealed) * m.count, 0) +
      (hand.context.dora ?? 0);
    const isPinfu = matches.some((m) => m.definition.id === 'pinfu');
    const fu = computeFu(reading, hand.context, isPinfu, ctx.isConcealed);
    const score = riichiBasePoints(fu.total, han, payout);
    return {
      ...base,
      valid: true,
      total: han,
      unit: 'han',
      fu,
      limitName: score.limitName ?? undefined,
      settlement: settleRiichi(payout, score, hand.context),
    };
  }

  const scoringTotal = matches.reduce(
    (sum, m) => sum + valueFor(m, ctx.isConcealed) * m.count,
    0,
  );
  const nonBonusTotal = matches
    .filter((m) => !BONUS_PATTERN_IDS.has(m.definition.id))
    .reduce((sum, m) => sum + valueFor(m, ctx.isConcealed) * m.count, 0);

  // ---- Taiwanese --------------------------------------------------------
  if (isTai(payout)) {
    return {
      ...base,
      valid: true,
      total: scoringTotal,
      unit: 'tai',
      limitName:
        payout.maxTai > 0 && scoringTotal > payout.maxTai ? `Capped at ${payout.maxTai} tai` : undefined,
      settlement: settleTai(payout, scoringTotal, hand.context),
    };
  }

  // ---- Hong Kong --------------------------------------------------------
  if (isFaan(payout)) {
    if (limitMatch) {
      return {
        ...base,
        valid: true,
        total: scoringTotal,
        unit: 'faan',
        limitName: 'Limit hand',
        settlement: settleFaan(payout, limitPoints(payout), hand.context),
      };
    }
    if (nonBonusTotal < payout.minimumFaan) {
      return {
        ...base,
        valid: false,
        reason: `Below the ${payout.minimumFaan} faan minimum (this hand is worth ${nonBonusTotal}).`,
        total: scoringTotal,
        unit: 'faan',
        settlement: null,
      };
    }
    return {
      ...base,
      valid: true,
      total: scoringTotal,
      unit: 'faan',
      settlement: settleFaan(payout, faanToPoints(payout, scoringTotal), hand.context),
    };
  }

  // ---- Chinese Official -------------------------------------------------
  if (isMcr(payout)) {
    if (nonBonusTotal < payout.minimumPoints) {
      return {
        ...base,
        valid: false,
        reason: `Below the ${payout.minimumPoints}-point minimum (this hand is worth ${nonBonusTotal} before flowers).`,
        total: scoringTotal,
        unit: 'points',
        settlement: null,
      };
    }
    return {
      ...base,
      valid: true,
      total: scoringTotal,
      unit: 'points',
      settlement: settleMcr(payout, scoringTotal, hand.context),
    };
  }

  return { ...base, valid: false, reason: 'Unknown payout model.', total: 0, unit: 'points', settlement: null };
}

/**
 * Score a hand, choosing the reading that pays best.
 *
 * A player would read their own hand the most favourable legal way, and every
 * ruleset here explicitly allows it, so the engine does the same rather than
 * taking whichever reading the parser happened to find first.
 */
export function scoreHand(hand: HandInput, rules: RuleSet): ScoreResult {
  const readings = decompose(hand, {
    handSize: rules.handSize,
    allowSevenPairs: rules.allowSevenPairs,
    allowThirteenOrphans: rules.allowThirteenOrphans,
  });

  if (readings.length === 0) {
    return {
      valid: false,
      reason: 'These tiles do not form a complete hand.',
      ruleSetId: rules.id,
      ruleSetName: rules.name,
      reading: null,
      patterns: [],
      total: 0,
      unit: unitFor(rules),
      settlement: null,
    };
  }

  const scored = readings.map((reading) => scoreReading(reading, hand, rules));
  const valid = scored.filter((s) => s.valid);
  const pool = valid.length > 0 ? valid : scored;

  return pool.reduce((best, candidate) => {
    const bestValue = best.settlement?.winnerReceives ?? -1;
    const candidateValue = candidate.settlement?.winnerReceives ?? -1;
    if (candidateValue !== bestValue) return candidateValue > bestValue ? candidate : best;
    return candidate.total > best.total ? candidate : best;
  });
}

function unitFor(rules: RuleSet): ScoringUnit {
  switch (rules.payout.model) {
    case 'tai':
      return 'tai';
    case 'faan':
      return 'faan';
    case 'riichi':
      return 'han';
    default:
      return 'points';
  }
}

export { unitFor };
