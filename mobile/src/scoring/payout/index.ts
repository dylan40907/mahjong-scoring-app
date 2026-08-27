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
  /** Seat relative to the winner, or 'discarder'. */
  readonly from: 'discarder' | 'dealer' | 'each-opponent';
  readonly amount: number;
  readonly label: string;
}

export interface Settlement {
  /** What the winner collects in total. */
  readonly winnerReceives: number;
  readonly payments: readonly PlayerPayment[];
  /** One line describing how the settlement was reached. */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// Taiwanese: 底 + 台
// ---------------------------------------------------------------------------

export function settleTai(config: TaiPayout, tai: number, context: HandContext): Settlement {
  const cappedTai = config.maxTai > 0 ? Math.min(tai, config.maxTai) : tai;
  const dealerFactor = context.isDealer ? config.dealerMultiplier : 1;
  const unit = Math.round((config.base + cappedTai * config.perTai) * dealerFactor);

  if (context.selfDrawn || config.discardPayer === 'everyone') {
    return {
      winnerReceives: unit * 3,
      payments: [{ from: 'each-opponent', amount: unit, label: 'Each opponent' }],
      explanation: context.selfDrawn
        ? `Self-drawn: all three opponents pay ${config.base} base + ${cappedTai} tai.`
        : `All three opponents pay ${config.base} base + ${cappedTai} tai.`,
    };
  }

  return {
    winnerReceives: unit,
    payments: [{ from: 'discarder', amount: unit, label: 'Discarder' }],
    explanation: `Won on a discard: the discarder alone pays ${config.base} base + ${cappedTai} tai.`,
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
      explanation: `Self-drawn: all three opponents pay double the hand's ${points}.`,
    };
  }

  const discarderAmount = config.discardPaysDouble ? points * 2 : points;
  if (!config.nonDiscardersPay) {
    return {
      winnerReceives: discarderAmount,
      payments: [{ from: 'discarder', amount: discarderAmount, label: 'Discarder' }],
      explanation: `Won on a discard: the discarder alone pays ${discarderAmount}.`,
    };
  }

  return {
    winnerReceives: discarderAmount + points * 2,
    payments: [
      { from: 'discarder', amount: discarderAmount, label: 'Discarder' },
      { from: 'each-opponent', amount: points, label: 'Each other player' },
    ],
    explanation: `Won on a discard: the discarder pays ${discarderAmount}, the other two pay ${points} each.`,
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
      explanation: `${score.han} han ${score.fu} fu, self-drawn by the dealer: all three pay ${rounded}.`,
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
    explanation: `${score.han} han ${score.fu} fu, self-drawn: the dealer pays ${fromDealer}, the others ${fromOthers} each.`,
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
      explanation: `Self-drawn: all three opponents pay ${points} + ${base}.`,
    };
  }
  return {
    winnerReceives: points + base * 3,
    payments: [
      { from: 'discarder', amount: points + base, label: 'Discarder' },
      { from: 'each-opponent', amount: base, label: 'Each other player' },
    ],
    explanation: `Won on a discard: the discarder pays ${points} + ${base}, the other two pay ${base} each.`,
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
