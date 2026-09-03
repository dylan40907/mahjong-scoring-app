import type { TileCode } from '@/tiles/tileset';
import type { HandContext, HandInput } from '../hand';
import { scoreHand } from '../score';
import { TAIWANESE_COMMON } from '../rulesets';
import { computeDeltas } from '@/lib/settlement';

/**
 * 連莊 - the dealer holding the deal, and what it costs.
 *
 * A Taiwanese dealer who wins keeps the deal and the streak grows. The tai
 * that streak is worth is charged in both directions: the dealer's own hand is
 * worth more, and when somebody else finally wins, the dealer pays the
 * difference on top of whatever else they owe. Only the second half makes a
 * long streak frightening rather than a free ride, so it is the half worth
 * testing hardest.
 */

const HAND: TileCode[] = [
  'man1', 'man2', 'man3',
  'man4', 'man5', 'man6',
  'pin1', 'pin2', 'pin3',
  'sou1', 'sou2', 'sou3',
  'sou5', 'sou6', 'sou7',
  'red', 'red',
];

function score(context: Partial<HandContext>) {
  const hand: HandInput = {
    concealed: HAND,
    exposed: [],
    bonus: [],
    winningTile: 'red',
    context: {
      selfDrawn: false,
      seatWind: 'east',
      roundWind: 'east',
      isDealer: false,
      ...context,
    },
  };
  return scoreHand(hand, TAIWANESE_COMMON);
}

describe('a dealer who keeps winning', () => {
  it('is worth more the longer the deal has been held', () => {
    const fresh = score({ isDealer: true, dealerStreak: 0 });
    const second = score({ isDealer: true, dealerStreak: 1 });
    const third = score({ isDealer: true, dealerStreak: 2 });

    // 連N拉N: one tai for dealing, two more per repeat, at ten points a tai.
    expect(second.settlement!.winnerReceives - fresh.settlement!.winnerReceives).toBe(20);
    expect(third.settlement!.winnerReceives - second.settlement!.winnerReceives).toBe(20);
  });

  it('costs the dealer nothing extra before the streak has started', () => {
    const settlement = score({ isDealer: false, dealerStreak: 0 }).settlement!;
    expect(settlement.payments.every((payment) => payment.from !== 'dealer-extra')).toBe(true);
  });
});

describe('a dealer who finally deals in', () => {
  it('pays the streak on top of the ordinary settlement', () => {
    const plain = score({ isDealer: false, dealerStreak: 0 }).settlement!;
    const streaking = score({ isDealer: false, dealerStreak: 3 }).settlement!;

    const extra = streaking.payments.find((payment) => payment.from === 'dealer-extra');
    // Three repeats x two tai x ten points.
    expect(extra?.amount).toBe(60);
    expect(streaking.winnerReceives).toBe(plain.winnerReceives + 60);
  });

  it('charges the dealer their share and the streak, and still sums to zero', () => {
    const settlement = score({ isDealer: false, dealerStreak: 2, selfDrawn: true }).settlement!;
    const deltas = computeDeltas({
      players: ['w', 'x', 'dealer', 'z'],
      winnerId: 'w',
      discarderId: null,
      dealerId: 'dealer',
      settlement,
    });

    const each = settlement.payments.find((p) => p.from === 'each-opponent')!.amount;
    const extra = settlement.payments.find((p) => p.from === 'dealer-extra')!.amount;

    expect(deltas.x).toBe(-each);
    // The dealer owes their ordinary share *and* the streak - 'dealer-extra' is
    // additive, unlike Riichi's 'dealer' line which replaces the share.
    expect(deltas.dealer).toBe(-(each + extra));
    expect(Object.values(deltas).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it('leaves the streak out entirely when the ruleset prices it at zero', () => {
    const noStreak = {
      ...TAIWANESE_COMMON,
      payout: { ...TAIWANESE_COMMON.payout, dealerTai: 0, streakTai: 0 },
    };
    const hand: HandInput = {
      concealed: HAND,
      exposed: [],
      bonus: [],
      winningTile: 'red',
      context: {
        selfDrawn: false,
        seatWind: 'east',
        roundWind: 'east',
        isDealer: false,
        dealerStreak: 5,
      },
    };
    const settlement = scoreHand(hand, noStreak).settlement!;
    expect(settlement.payments.every((payment) => payment.from !== 'dealer-extra')).toBe(true);
  });
});
