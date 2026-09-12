import type { HandContext } from '../hand';
import type { FaanPayout, McrPayout, PayoutConfig, RiichiPayout, TaiPayout } from '../rulesets/types';

/**
 * Turning a scored hand into a settlement.
 *
 * The four rulesets disagree about this more than they disagree about
 * patterns. Taiwanese adds a flat base to a per-tai rate and makes a discarder
 * pay alone; Hong Kong doubles faan into a table that flattens at the top;
 * Riichi multiplies fu by two to the power of the han and then caps the result
 * in five discrete steps; MCR just adds points and charges everyone a flat
 * eight on top. Each gets its own function rather than a shared abstraction,
 * because the shared abstraction would be a switch statement wearing a hat.
 */

export interface PlayerPayment {
  /**
   * Who owes it.
   *
   * 'dealer' replaces that player's ordinary share, which is what Riichi's
   * self-draw does. 'dealer-extra' is charged *on top* of whatever else they
   * already owe, which is what a Taiwanese streak does to a dealer who just
   * lost one.
   */
  readonly from: 'discarder' | 'dealer' | 'dealer-extra' | 'each-opponent';
  readonly amount: number;
  readonly label: string;
}

export interface Settlement {
  /** What the winner collects in total. */
  readonly winnerReceives: number;
  readonly payments: readonly PlayerPayment[];
  /**
   * One line describing how the settlement was reached.
   *
   * It has to end in the number the player is actually about to see change on
   * the table, with every step that got there written out. "30 base + 49 tai"
   * looked like it should come to 79 and the app then moved 520, because a tai
   * is a *count* and the money is `perTai` per tai - which the sentence never
   * said. A settlement nobody can check by hand is the one thing this screen
   * exists to prevent.
   */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// Taiwanese: 底 + 台
// ---------------------------------------------------------------------------

export function settleTai(config: TaiPayout, tai: number, context: HandContext): Settlement {
  /*
   * 連莊 - what the deal is worth for having been held.
   *
   * One tai for sitting as dealer plus two for each repeat is the ordinary
   * Taiwanese table, and it cuts both ways: the dealer collects it when they
   * win again and pays it when they finally deal in. That second half is the
   * whole reason a long streak is tense rather than simply good, so leaving it
   * out would have made streaks a pure bonus.
   */
  const streak = Math.max(0, context.dealerStreak ?? 0);
  const dealerTai = config.dealerTai + config.streakTai * streak;

  const handTai = config.maxTai > 0 ? Math.min(tai, config.maxTai) : tai;
  const cappedTai = context.isDealer
    ? config.maxTai > 0
      ? Math.min(tai + dealerTai, config.maxTai)
      : tai + dealerTai
    : handTai;
  const dealerFactor = context.isDealer ? config.dealerMultiplier : 1;
  const unit = Math.round((config.base + cappedTai * config.perTai) * dealerFactor);

  /*
   * What the dealer owes on top, having lost while holding the deal.
   *
   * The streak only, not the flat tai for sitting as dealer: 拉莊 is a charge
   * for the run they were on, and a dealer who has just picked up the deal is
   * on no run at all. So a fresh dealership costs its holder nothing extra,
   * and the third hand of a streak costs them plenty.
   */
  const streakDue = context.isDealer ? 0 : Math.round(config.streakTai * streak * config.perTai);
  const streakLine: PlayerPayment[] =
    streakDue > 0
      ? [{ from: 'dealer-extra', amount: streakDue, label: 'Dealer (streak)' }]
      : [];
  const streakNote = streakDue > 0 ? ` The dealer adds ${streakDue} for the deal they held.` : '';

  // The tai count multiplied out, so the sentence lands on the amount paid.
  const hand = `${config.base} + ${cappedTai} × ${config.perTai}`;
  const sum = dealerFactor === 1 ? hand : `(${hand}) × ${dealerFactor}`;

  if (context.selfDrawn || config.discardPayer === 'everyone') {
    return {
      winnerReceives: unit * 3 + streakDue,
      payments: [
        { from: 'each-opponent', amount: unit, label: 'Each opponent' },
        ...streakLine,
      ],
      explanation:
        (context.selfDrawn
          ? `Self-draw: each opponent pays ${sum} = ${unit}.`
          : `Each opponent pays ${sum} = ${unit}.`) + streakNote,
    };
  }

  return {
    winnerReceives: unit + streakDue,
    payments: [
      { from: 'discarder', amount: unit, label: 'Discarder' },
      ...streakLine,
    ],
    explanation: `The discarder pays it alone: ${sum} = ${unit}.` + streakNote,
  };
}

// ---------------------------------------------------------------------------
// Hong Kong: faan doubling into a flattening table
// ---------------------------------------------------------------------------

export function faanToPoints(config: FaanPayout, faan: number): number {
  let points = config.table[0]?.points ?? 1;
  for (const row of config.table) {
    if (faan >= row.faan) points = row.points;
  }
  return points;
}

export function limitPoints(config: FaanPayout): number {
  return config.table[config.table.length - 1]?.points ?? 64;
}

/**
 * The faan a limit hand counts as: the row the table tops out at.
 *
 * What a limit hand is paid as, and so the number to show for it. Its own
 * patterns might add up to four faan on the way - Big Three Dragons is worth
 * nothing of itself here, it only makes the hand a limit - and showing that
 * four beside a payment worth ten made the best hand of the night look like a
 * modest one.
 */
export function limitFaan(config: FaanPayout): number {
  return config.table[config.table.length - 1]?.faan ?? 10;
}

export function settleFaan(
  config: FaanPayout,
  points: number,
  context: HandContext,
): Settlement {
  if (context.selfDrawn) {
    const each = points * 2;
    return {
      winnerReceives: each * 3,
      payments: [{ from: 'each-opponent', amount: each, label: 'Each opponent' }],
      explanation: `Self-draw: each opponent pays double, ${points} × 2 = ${each}.`,
    };
  }

  const discarderAmount = config.discardPaysDouble ? points * 2 : points;
  if (!config.nonDiscardersPay) {
    return {
      winnerReceives: discarderAmount,
      payments: [{ from: 'discarder', amount: discarderAmount, label: 'Discarder' }],
      explanation: config.discardPaysDouble
        ? `The discarder pays it alone, doubled: ${points} × 2 = ${discarderAmount}.`
        : `The discarder pays it alone: ${discarderAmount}.`,
    };
  }

  return {
    winnerReceives: discarderAmount + points * 2,
    payments: [
      { from: 'discarder', amount: discarderAmount, label: 'Discarder' },
      { from: 'each-opponent', amount: points, label: 'Each other player' },
    ],
    explanation:
      `The discarder pays ${discarderAmount}, the other two ${points} each: ` +
      `${discarderAmount + points * 2} in all.`,
  };
}

// ---------------------------------------------------------------------------
// Riichi: fu and han
// ---------------------------------------------------------------------------

export interface RiichiScore {
  readonly fu: number;
  readonly han: number;
  readonly basePoints: number;
  /** 'Mangan', 'Haneman', … or null below the limit. */
  readonly limitName: string | null;
}

const LIMIT_STEPS: readonly { minHan: number; base: number; name: string }[] = [
  { minHan: 13, base: 8000, name: 'Kazoe Yakuman' },
  { minHan: 11, base: 6000, name: 'Sanbaiman' },
  { minHan: 8, base: 4000, name: 'Baiman' },
  { minHan: 6, base: 3000, name: 'Haneman' },
  { minHan: 5, base: 2000, name: 'Mangan' },
];

/** fu x 2^(2+han), then clamped by the limit table. */
export function riichiBasePoints(
  fu: number,
  han: number,
  config: RiichiPayout,
): RiichiScore {
  for (const step of LIMIT_STEPS) {
    if (han >= step.minHan) {
      return { fu, han, basePoints: step.base, limitName: step.name };
    }
  }

  const raw = fu * Math.pow(2, 2 + han);
  if (raw >= 2000) {
    return { fu, han, basePoints: 2000, limitName: 'Mangan' };
  }
  if (config.kiriageMangan && ((han === 4 && fu >= 30) || (han === 3 && fu >= 60))) {
    return { fu, han, basePoints: 2000, limitName: 'Mangan (rounded up)' };
  }
  return { fu, han, basePoints: raw, limitName: null };
}

/** Riichi always rounds a payment up to the next hundred. */
function roundUp100(value: number): number {
  return Math.ceil(value / 100) * 100;
}

export function settleRiichi(
  config: RiichiPayout,
  score: RiichiScore,
  context: HandContext,
  honba = 0,
): Settlement {
  const base = score.basePoints;
  const honbaBonus = honba * config.honbaValue;

  if (!context.selfDrawn) {
    const multiplier = context.isDealer ? 6 : 4;
    const amount = roundUp100(base * multiplier) + honbaBonus;
    return {
      winnerReceives: amount,
      payments: [{ from: 'discarder', amount, label: 'Discarder' }],
      explanation: `${score.han} han ${score.fu} fu: the discarder pays ${amount}.`,
    };
  }

  if (context.isDealer) {
    const each = roundUp100(base * 2) + honbaBonus / 3;
    const rounded = Math.ceil(each);
    return {
      winnerReceives: rounded * 3,
      payments: [{ from: 'each-opponent', amount: rounded, label: 'Each opponent' }],
      explanation:
        `${score.han} han ${score.fu} fu, self-drawn by the dealer: ` +
        `each opponent pays ${rounded}, ${rounded * 3} in all.`,
    };
  }

  const fromDealer = roundUp100(base * 2) + Math.ceil(honbaBonus / 3);
  const fromOthers = roundUp100(base) + Math.ceil(honbaBonus / 3);
  return {
    winnerReceives: fromDealer + fromOthers * 2,
    payments: [
      { from: 'dealer', amount: fromDealer, label: 'Dealer' },
      { from: 'each-opponent', amount: fromOthers, label: 'Each other player' },
    ],
    explanation:
      `${score.han} han ${score.fu} fu, self-drawn: the dealer pays ${fromDealer}, ` +
      `the others ${fromOthers} each, ${fromDealer + fromOthers * 2} in all.`,
  };
}

// ---------------------------------------------------------------------------
// Chinese Official
// ---------------------------------------------------------------------------

export function settleMcr(config: McrPayout, points: number, context: HandContext): Settlement {
  const base = config.basePerPlayer;
  if (context.selfDrawn) {
    const each = points + base;
    return {
      winnerReceives: each * 3,
      payments: [{ from: 'each-opponent', amount: each, label: 'Each opponent' }],
      explanation: `Self-draw: each opponent pays ${points} + ${base} = ${each}.`,
    };
  }
  return {
    winnerReceives: points + base * 3,
    payments: [
      { from: 'discarder', amount: points + base, label: 'Discarder' },
      { from: 'each-opponent', amount: base, label: 'Each other player' },
    ],
    explanation:
      `The discarder pays ${points} + ${base} = ${points + base}, ` +
      `the other two ${base} each: ${points + base * 3} in all.`,
  };
}

export function isTai(config: PayoutConfig): config is TaiPayout {
  return config.model === 'tai';
}
export function isFaan(config: PayoutConfig): config is FaanPayout {
  return config.model === 'faan';
}
export function isRiichi(config: PayoutConfig): config is RiichiPayout {
  return config.model === 'riichi';
}
export function isMcr(config: PayoutConfig): config is McrPayout {
  return config.model === 'mcr';
}
