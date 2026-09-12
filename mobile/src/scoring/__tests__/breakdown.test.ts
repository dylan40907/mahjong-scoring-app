import type { TileCode } from '@/tiles/tileset';
import { breakdownOf, scoreText } from '../breakdown';
import type { HandInput } from '../hand';
import { HONG_KONG_OLD_STYLE, TAIWANESE_COMMON } from '../rulesets';
import { scoreHand } from '../score';

/**
 * The sheet that opens when a hand is tapped.
 *
 * It replaced a list of pattern names that said what scored and not how much,
 * so what matters here is that each line carries the right value and - where
 * there are particular tiles behind it - the right tiles, and that the total
 * is what the hand was actually paid as.
 */

function hand(
  concealed: TileCode[],
  winningTile: TileCode,
  overrides: Partial<HandInput> = {},
): HandInput {
  return {
    concealed,
    exposed: [],
    bonus: [],
    winningTile,
    context: { selfDrawn: false, seatWind: 'east', roundWind: 'east', isDealer: false },
    ...overrides,
  };
}

// Three dragon pungs, a pung of ones and a pair of
// fives, all circles and dragons, won on a discard.
const BIG_THREE: HandInput = hand(
  [
    'red', 'red', 'red', 'green', 'green', 'green', 'white', 'white', 'white',
    'pin1', 'pin1', 'pin1', 'pin5', 'pin5',
  ],
  'pin5',
);

describe('a limit hand', () => {
  const result = scoreHand(BIG_THREE, HONG_KONG_OLD_STYLE);

  it('counts as what it is paid, not what its other patterns sum to', () => {
    // Half Flush and No Flowers make four; Big Three Dragons makes it a limit,
    // which pays the top of the table - ten faan's worth.
    expect(result.limitName).toBe('Limit hand');
    expect(result.total).toBe(10);
    expect(scoreText(result.total, result.unit, result.limitName)).toBe('10 faan · Limit hand');
  });

  it('shows each pattern’s own value, and says the limit is a limit', () => {
    const lines = breakdownOf(result, BIG_THREE, HONG_KONG_OLD_STYLE).lines;
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
    expect(byId['big-three-dragons'].amount).toBe('Limit');
    expect(byId['half-flush'].amount).toBe('+3 faan');
    expect(byId['no-flowers'].amount).toBe('+1 faan');
  });

  it('shows the three dragon pungs under Big Three Dragons', () => {
    const line = breakdownOf(result, BIG_THREE, HONG_KONG_OLD_STYLE).lines.find(
      (l) => l.id === 'big-three-dragons',
    );
    const sets = (line?.tiles ?? []).map((group) => group.join(','));
    expect(sets.sort()).toEqual(['green,green,green', 'red,red,red', 'white,white,white']);
  });

  it('shows no tiles for a pattern that is about the hand as a whole', () => {
    const lines = breakdownOf(result, BIG_THREE, HONG_KONG_OLD_STYLE).lines;
    // No flowers has nothing to point at; a flush would only repeat the hand.
    expect(lines.find((l) => l.id === 'no-flowers')?.tiles).toBeNull();
    expect(lines.find((l) => l.id === 'half-flush')?.tiles).toBeNull();
  });

  it('explains why the total is not the sum of its lines', () => {
    expect(breakdownOf(result, BIG_THREE, HONG_KONG_OLD_STYLE).note).toMatch(/top of the table/);
  });
});

describe('an ordinary hand', () => {
  it('adds up, and counts a repeated pattern once per time it applied', () => {
    // Two dragon pungs in a Taiwanese hand: one tai each.
    const tiles: TileCode[] = [
      'red', 'red', 'red', 'green', 'green', 'green',
      'man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'sou2', 'sou3', 'sou4', 'pin9', 'pin9',
    ];
    const result = scoreHand(hand(tiles, 'pin9'), TAIWANESE_COMMON);
    const line = breakdownOf(result, hand(tiles, 'pin9'), TAIWANESE_COMMON).lines.find(
      (l) => l.id === 'dragon-pung',
    );
    expect(line?.amount).toBe('×2 · +2 tai');
    expect(line?.tiles).toHaveLength(2);
  });

  it('shows the set a wait was completed in', () => {
    // 1-2 waiting on 3: an edge wait, completed by the three.
    const tiles: TileCode[] = [
      'man1', 'man2', 'man3', 'pin2', 'pin3', 'pin4', 'sou5', 'sou6', 'sou7',
      'sou7', 'sou8', 'sou9', 'east', 'east', 'east', 'pin5', 'pin5',
    ];
    const edge = hand(tiles, 'man3');
    const result = scoreHand(edge, TAIWANESE_COMMON);
    const line = breakdownOf(result, edge, TAIWANESE_COMMON).lines.find((l) => l.id === 'edge-wait');
    expect(line?.tiles).toEqual([['man1', 'man2', 'man3']]);
  });
});
