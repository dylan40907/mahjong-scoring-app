import { computeDeltas } from '../settlement';
import {
  scoreHand,
  CHINESE_OFFICIAL,
  HONG_KONG_OLD_STYLE,
  RIICHI,
  TAIWANESE_COMMON,
} from '@/scoring';
import type { HandContext, HandInput } from '@/scoring';
import type { TileCode } from '@/tiles/tileset';

const PLAYERS = ['a', 'b', 'c', 'd'];

function sum(deltas: Record<string, number>): number {
  return Object.values(deltas).reduce((total, value) => total + value, 0);
}

describe('settlement ledger', () => {
  it('charges only the discarder when the ruleset says so', () => {
    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'a',
      discarderId: 'c',
      dealerId: 'a',
      settlement: { payments: [{ from: 'discarder', amount: 120, label: 'Discarder' }] },
    });

    expect(deltas).toEqual({ a: 120, b: 0, c: -120, d: 0 });
    expect(sum(deltas)).toBe(0);
  });

  it('charges all three opponents on a self-draw', () => {
    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'b',
      discarderId: null,
      dealerId: 'a',
      settlement: { payments: [{ from: 'each-opponent', amount: 50, label: 'Each opponent' }] },
    });

    expect(deltas).toEqual({ a: -50, b: 150, c: -50, d: -50 });
    expect(sum(deltas)).toBe(0);
  });

  it('does not double-charge the dealer when a dealer line is present', () => {
    // Riichi's non-dealer tsumo: the dealer pays double, the other two a single
    // share. The dealer must not also be swept up by the each-opponent line.
    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'c',
      discarderId: null,
      dealerId: 'a',
      settlement: {
        payments: [
          { from: 'dealer', amount: 2600, label: 'Dealer' },
          { from: 'each-opponent', amount: 1300, label: 'Each other player' },
        ],
      },
    });

    expect(deltas.a).toBe(-2600);
    expect(deltas.b).toBe(-1300);
    expect(deltas.d).toBe(-1300);
    expect(deltas.c).toBe(5200);
    expect(sum(deltas)).toBe(0);
  });

  it('charges the discarder more and the others the base amount', () => {
    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'd',
      discarderId: 'b',
      dealerId: 'a',
      settlement: {
        payments: [
          { from: 'discarder', amount: 32, label: 'Discarder' },
          { from: 'each-opponent', amount: 16, label: 'Each other player' },
        ],
      },
    });

    expect(deltas.b).toBe(-32);
    expect(deltas.a).toBe(-16);
    expect(deltas.c).toBe(-16);
    expect(deltas.d).toBe(64);
    expect(sum(deltas)).toBe(0);
  });

  it('does not charge a dealer who won the hand', () => {
    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'a',
      discarderId: null,
      dealerId: 'a',
      settlement: {
        payments: [
          { from: 'dealer', amount: 900, label: 'Dealer' },
          { from: 'each-opponent', amount: 400, label: 'Each other player' },
        ],
      },
    });

    expect(deltas.a).toBeGreaterThan(0);
    expect(sum(deltas)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End to end: a scored hand all the way to a balanced ledger
// ---------------------------------------------------------------------------

const context: HandContext = {
  selfDrawn: false,
  seatWind: 'east',
  roundWind: 'east',
  isDealer: false,
};

function hand(concealed: TileCode[], winningTile: TileCode, extra: Partial<HandContext> = {}): HandInput {
  return { concealed, exposed: [], bonus: [], winningTile, context: { ...context, ...extra } };
}

describe('scored hands settle to zero', () => {
  const cases: [string, HandInput, typeof TAIWANESE_COMMON][] = [
    [
      'Taiwanese, won on a discard',
      hand(
        [
          'man1', 'man2', 'man3', 'man4', 'man5', 'man6',
          'pin1', 'pin2', 'pin3', 'sou7', 'sou8', 'sou9',
          'east', 'east', 'east', 'red', 'red',
        ],
        'red',
      ),
      TAIWANESE_COMMON,
    ],
    [
      'Hong Kong, self-drawn',
      hand(
        [
          'sou1', 'sou1', 'sou1', 'sou5', 'sou5', 'sou5',
          'sou9', 'sou9', 'sou9', 'east', 'east', 'east', 'red', 'red',
        ],
        'red',
        { selfDrawn: true },
      ),
      HONG_KONG_OLD_STYLE as unknown as typeof TAIWANESE_COMMON,
    ],
    [
      'Riichi, self-drawn by a non-dealer',
      hand(
        [
          'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
          'pin2', 'pin3', 'pin4', 'sou6', 'sou7', 'sou8', 'sou5', 'sou5',
        ],
        'man4',
        { selfDrawn: true, riichi: true },
      ),
      RIICHI as unknown as typeof TAIWANESE_COMMON,
    ],
  ];

  it.each(cases)('%s', (_label, input, rules) => {
    const result = scoreHand(input, rules);
    expect(result.valid).toBe(true);
    expect(result.settlement).not.toBeNull();

    const deltas = computeDeltas({
      players: PLAYERS,
      winnerId: 'b',
      discarderId: input.context.selfDrawn ? null : 'c',
      dealerId: 'a',
      settlement: result.settlement!,
    });

    expect(sum(deltas)).toBe(0);
    expect(deltas.b).toBe(result.settlement!.winnerReceives);
  });
});

/**
 * The sentence on the settlement panel has to be checkable by hand.
 *
 * It said "30 base + 49 tai" and then moved 520 points, because a tai is a
 * count and the money is `perTai` per tai - a step the sentence never showed.
 * Anyone reading it would work out 79 and conclude the app was wrong. So the
 * rule is that the last number in the explanation is a number that actually
 * changes hands, which is the cheapest possible check that no step is missing.
 */
describe('the settlement explains the number it moved', () => {
  const lastNumber = (text: string): number => {
    const numbers = text.match(/\d+/g);
    expect(numbers).not.toBeNull();
    return Number(numbers![numbers!.length - 1]);
  };

  const cases = [
    ['Taiwanese, discard', TAIWANESE_COMMON, false],
    ['Taiwanese, self-draw', TAIWANESE_COMMON, true],
    ['Hong Kong, discard', HONG_KONG_OLD_STYLE, false],
    ['Hong Kong, self-draw', HONG_KONG_OLD_STYLE, true],
    ['Riichi, discard', RIICHI, false],
    ['Riichi, self-draw', RIICHI, true],
    ['Chinese Official, discard', CHINESE_OFFICIAL, false],
    ['Chinese Official, self-draw', CHINESE_OFFICIAL, true],
  ] as const;

  it.each(cases)('%s', (_name, rules, selfDrawn) => {
    // A concealed all-pungs hand, which scores under every ruleset here.
    const tiles: TileCode[] = [
      'man2', 'man2', 'man2',
      'man5', 'man5', 'man5',
      'pin3', 'pin3', 'pin3',
      'sou7', 'sou7', 'sou7',
      'red', 'red',
    ];
    const extra: TileCode[] = ['pin6', 'pin6', 'pin6'];
    const concealed = rules.handSize === 16 ? [...tiles, ...extra] : tiles;

    const result = scoreHand(
      {
        concealed,
        exposed: [],
        bonus: [],
        winningTile: 'red',
        context: { selfDrawn, seatWind: 'east', roundWind: 'east', isDealer: false },
      },
      rules,
    );

    const settlement = result.settlement;
    expect(settlement).not.toBeNull();

    const paid = [
      settlement!.winnerReceives,
      ...settlement!.payments.map((payment) => payment.amount),
    ];
    expect(paid).toContain(lastNumber(settlement!.explanation));
  });
});
