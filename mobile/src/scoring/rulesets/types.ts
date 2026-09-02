/**
 * A ruleset is data, not code.
 *
 * Every scoring pattern the app knows how to detect lives in the pattern
 * library, keyed by a stable id. A ruleset picks ids out of that library and
 * attaches numbers to them. Nothing else distinguishes Taiwanese scoring from
 * Hong Kong scoring except which ids appear and what they are worth - and the
 * payout model that turns the total into money.
 *
 * The consequence is that a user-authored ruleset is the same kind of object
 * as a built-in one. Editing values, disabling patterns, or starting from a
 * preset and diverging all work without shipping code, and a custom ruleset
 * serialises to plain JSON.
 */

import type { CustomHand } from '../patterns/custom';

export type RuleFamily = 'taiwanese' | 'hongkong' | 'riichi' | 'mcr' | 'custom';

export interface PatternValue {
  /** Points, tai, faan or han - whatever the payout model counts in. */
  readonly value: number;
  /**
   * Value when the hand contains an exposed meld. Riichi halves or drops many
   * yaku on an open hand; most other rulesets do not care. Defaults to `value`.
   */
  readonly openValue?: number;
  /** The pattern scores nothing unless nothing was claimed from a discard. */
  readonly concealedOnly?: boolean;
  /**
   * The pattern is a limit hand. The number is how many limits it is worth,
   * so 1 is a yakuman and 2 a double yakuman. A limit hand replaces the
   * accumulated total rather than adding to it.
   */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Payout models
// ---------------------------------------------------------------------------

/** Taiwanese: a flat base (底) plus a per-tai (台) rate. */
export interface TaiPayout {
  readonly model: 'tai';
  /** 底 - paid on any win regardless of pattern. */
  readonly base: number;
  /** 台 - the value of a single tai. */
  readonly perTai: number;
  /** Tables often cap the total; 0 means uncapped. */
  readonly maxTai: number;
  /**
   * Who pays on a discard win. Taiwanese tables overwhelmingly make the
   * discarder pay the whole amount alone (放槍), which is why discarding into
   * a big hand is so feared.
   */
  readonly discardPayer: 'discarder-alone' | 'everyone';
  /** Dealer wins and losses are often multiplied. 1 disables it. */
  readonly dealerMultiplier: number;
}

/** Hong Kong: faan doubles into a points table that flattens at the top. */
export interface FaanPayout {
  readonly model: 'faan';
  /** Hands below this faan count cannot be declared. */
  readonly minimumFaan: number;
  /** Ascending faan thresholds mapped to the points paid. */
  readonly table: readonly { readonly faan: number; readonly points: number }[];
  /** The discarder pays twice the base amount. */
  readonly discardPaysDouble: boolean;
  /** Players who did not discard still pay the base amount. */
  readonly nonDiscardersPay: boolean;
}

/** Riichi: fu and han, resolved through the standard limit table. */
export interface RiichiPayout {
  readonly model: 'riichi';
  /** Round 4 han 30 fu and 3 han 60 fu up to mangan. A common house rule. */
  readonly kiriageMangan: boolean;
  /** Points per counter stick on the table. */
  readonly honbaValue: number;
}

/** Chinese Official: fan points plus a flat per-player base. */
export interface McrPayout {
  readonly model: 'mcr';
  /** A hand must reach this many points, excluding flowers, to be declared. */
  readonly minimumPoints: number;
  /** Every player pays this on any win, on top of the hand value. */
  readonly basePerPlayer: number;
}

export type PayoutConfig = TaiPayout | FaanPayout | RiichiPayout | McrPayout;

// ---------------------------------------------------------------------------
// Ruleset
// ---------------------------------------------------------------------------

export interface RuleSet {
  readonly id: string;
  readonly name: string;
  /** One line shown under the name in the ruleset list. */
  readonly subtitle: string;
  readonly family: RuleFamily;
  /** Tiles in a complete hand before the winning tile: 13 or 16. */
  readonly handSize: 13 | 16;
  /** Whether flowers and seasons are in play at all. */
  readonly usesBonusTiles: boolean;
  readonly allowSevenPairs: boolean;
  readonly allowThirteenOrphans: boolean;
  /**
   * The hand must match at least one scoring pattern beyond the situational
   * ones to be declarable. This is Riichi's defining constraint and does not
   * apply elsewhere.
   */
  readonly requiresYaku: boolean;
  /** Pattern id to value. A missing id means the pattern does not score here. */
  readonly patterns: Readonly<Record<string, PatternValue>>;
  /**
   * Hands this table made up, described rather than coded.
   *
   * Their ids appear in `patterns` like any other, which is what lets them be
   * turned off or revalued without being deleted.
   */
  readonly customHands?: readonly CustomHand[];
  readonly payout: PayoutConfig;
  /** False for user-authored rulesets. */
  readonly builtIn: boolean;
  /** For custom rulesets: the preset it was cloned from. */
  readonly derivedFrom?: string;
  /** Longer explanation shown on the ruleset detail screen. */
  readonly notes?: string;
}

/** The shape persisted for a user-authored ruleset. */
export interface CustomRuleSet extends RuleSet {
  readonly builtIn: false;
  readonly derivedFrom: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isCustomRuleSet(rules: RuleSet): rules is CustomRuleSet {
  return !rules.builtIn;
}

/** Convenience for building preset tables without repeating the wrapper. */
export function values(map: Record<string, number>): Record<string, PatternValue> {
  return Object.fromEntries(Object.entries(map).map(([id, value]) => [id, { value }]));
}
