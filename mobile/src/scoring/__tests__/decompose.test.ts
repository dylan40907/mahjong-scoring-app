import type { TileCode } from '@/tiles/tileset';
import { decompose } from '../decompose';
import type { HandContext, HandInput, Meld } from '../hand';

const baseContext: HandContext = {
  selfDrawn: false,
  seatWind: 'east',
  roundWind: 'east',
  isDealer: true,
};

function hand(
  concealed: TileCode[],
  winningTile: TileCode,
  melds: Meld[] = [],
  context: Partial<HandContext> = {},
): HandInput {
  return { concealed, melds, bonus: [], winningTile, context: { ...baseContext, ...context } };
}

/** Compact reading description, for asserting on structure without noise. */
function describeReading(melds: readonly Meld[]): string {
  return melds
    .map((m) => `${m.kind}(${m.tiles.join(' ')})`)
    .sort()
    .join(' ');
}

describe('standard decomposition', () => {
  it('parses a plain four-set hand with a pair', () => {
    const tiles: TileCode[] = [
      'man1', 'man2', 'man3',
      'pin4', 'pin5', 'pin6',
      'sou7', 'sou8', 'sou9',
      'east', 'east', 'east',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'man3'), { handSize: 13 });
    expect(readings.length).toBeGreaterThan(0);
    expect(describeReading(readings[0].melds)).toBe(
      'chow(man1 man2 man3) chow(pin4 pin5 pin6) chow(sou7 sou8 sou9) pair(red red) pung(east east east)',
    );
  });

  it('finds both readings of an ambiguous triplets-or-runs shape', () => {
    // 111222333 in one suit is genuinely three triplets *and* three identical
    // runs. Which reading wins differs by ruleset - All Triplets against Pure
    // Triple Chow - so both must survive enumeration.
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1', 'man2', 'man2', 'man2', 'man3', 'man3', 'man3',
      'pin4', 'pin5', 'pin6',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'pin6'), { handSize: 13 });
    const shapes = new Set(readings.map((r) => describeReading(r.melds)));
    const asTriplets = [...shapes].some(
      (s) => s.includes('pung(man1 man1 man1)') && s.includes('pung(man3 man3 man3)'),
    );
    const asRuns = [...shapes].some(
      (s) => (s.match(/chow\(man1 man2 man3\)/g) ?? []).length === 3,
    );
    expect(asTriplets).toBe(true);
    expect(asRuns).toBe(true);
  });

  it('does not invent a second pair to make a hand parse', () => {
    // 111234 leaves a floating 4 once 1-2-3 is taken, and the red pair is
    // already spoken for, so only the pung reading is legal.
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1', 'man2', 'man3', 'man4',
      'pin1', 'pin2', 'pin3',
      'sou5', 'sou6', 'sou7',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'man4'), { handSize: 13 });
    const shapes = new Set(readings.map((r) => describeReading(r.melds)));
    expect([...shapes].every((s) => s.includes('pung(man1 man1 man1)'))).toBe(true);
    expect([...shapes].every((s) => s.includes('pair(red red)'))).toBe(true);
  });

  it('rejects a hand that does not form sets and a pair', () => {
    const tiles: TileCode[] = [
      'man1', 'man3', 'man5', 'man7', 'man9',
      'pin2', 'pin4', 'pin6', 'pin8',
      'sou1', 'sou3', 'sou5', 'sou7', 'north',
    ];
    expect(decompose(hand(tiles, 'north'), { handSize: 13, allowSevenPairs: false })).toHaveLength(0);
  });

  it('accounts for exposed melds when counting the sets still needed', () => {
    const melds: Meld[] = [
      { kind: 'pung', tiles: ['green', 'green', 'green'], concealed: false },
      { kind: 'chow', tiles: ['pin1', 'pin2', 'pin3'], concealed: false },
    ];
    const tiles: TileCode[] = ['man1', 'man2', 'man3', 'sou7', 'sou8', 'sou9', 'west', 'west'];
    const readings = decompose(hand(tiles, 'sou9', melds), { handSize: 13 });
    expect(readings.length).toBeGreaterThan(0);
    expect(readings[0].melds).toHaveLength(5);
  });
});

describe('sixteen-tile hands', () => {
  it('parses a Taiwanese five-set hand', () => {
    const tiles: TileCode[] = [
      'man1', 'man2', 'man3',
      'man4', 'man5', 'man6',
      'pin1', 'pin2', 'pin3',
      'sou7', 'sou8', 'sou9',
      'east', 'east', 'east',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'red'), { handSize: 16 });
    expect(readings.length).toBeGreaterThan(0);
    expect(readings[0].melds.filter((m) => m.kind !== 'pair')).toHaveLength(5);
  });
});

describe('special shapes', () => {
  it('recognises seven pairs', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man4', 'man4', 'pin2', 'pin2', 'pin7', 'pin7',
      'sou3', 'sou3', 'sou9', 'sou9', 'west', 'west',
    ];
    const readings = decompose(hand(tiles, 'west'), { handSize: 13 });
    expect(readings.some((r) => r.special === 'seven-pairs')).toBe(true);
  });

  it('recognises thirteen orphans', () => {
    const tiles: TileCode[] = [
      'man1', 'man9', 'pin1', 'pin9', 'sou1', 'sou9',
      'east', 'south', 'west', 'north', 'red', 'green', 'white', 'white',
    ];
    const readings = decompose(hand(tiles, 'white'), { handSize: 13 });
    expect(readings.some((r) => r.special === 'thirteen-orphans')).toBe(true);
  });

  it('recognises the Taiwanese eight-pairs-and-a-triplet shape', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1', 'man4', 'man4', 'pin2', 'pin2', 'pin7', 'pin7',
      'sou3', 'sou3', 'sou9', 'sou9', 'west', 'west', 'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'red'), { handSize: 16 });
    expect(readings.some((r) => r.special === 'eight-pairs-triplet')).toBe(true);
  });
});

describe('wait classification', () => {
  const suffix: TileCode[] = ['pin1', 'pin2', 'pin3', 'sou5', 'sou6', 'sou7', 'red', 'red', 'green', 'green', 'green'];

  it('calls a middle-tile completion a closed wait', () => {
    const readings = decompose(hand(['man4', 'man5', 'man6', ...suffix], 'man5'), { handSize: 13 });
    expect(readings.some((r) => r.waitType === 'closed')).toBe(true);
  });

  it('calls a three-onto-one-two completion an edge wait', () => {
    const readings = decompose(hand(['man1', 'man2', 'man3', ...suffix], 'man3'), { handSize: 13 });
    expect(readings.some((r) => r.waitType === 'edge')).toBe(true);
  });

  it('calls a two-sided completion an open wait', () => {
    const readings = decompose(hand(['man4', 'man5', 'man6', ...suffix], 'man6'), { handSize: 13 });
    expect(readings.some((r) => r.waitType === 'open')).toBe(true);
  });

  it('calls completing the pair a single wait', () => {
    const readings = decompose(hand(['man4', 'man5', 'man6', ...suffix], 'red'), { handSize: 13 });
    expect(readings.some((r) => r.waitType === 'single')).toBe(true);
  });
});
