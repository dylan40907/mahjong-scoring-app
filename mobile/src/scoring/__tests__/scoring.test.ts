import type { TileCode } from '@/tiles/tileset';
import type { HandContext, HandInput, Meld } from '../hand';
import { scoreHand } from '../score';
import {
  CHINESE_OFFICIAL,
  HONG_KONG_OLD_STYLE,
  HONG_KONG_THREE_FAAN,
  RIICHI,
  TAIWANESE_COMMON,
} from '../rulesets';

const defaults: HandContext = {
  selfDrawn: false,
  seatWind: 'east',
  roundWind: 'east',
  isDealer: false,
};

function hand(
  concealed: TileCode[],
  winningTile: TileCode,
  options: { melds?: Meld[]; bonus?: TileCode[]; context?: Partial<HandContext> } = {},
): HandInput {
  return {
    concealed,
    melds: options.melds ?? [],
    bonus: options.bonus ?? [],
    winningTile,
    context: { ...defaults, ...options.context },
  };
}

function patternIds(result: ReturnType<typeof scoreHand>): string[] {
  return result.patterns.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Riichi: worked examples with published answers
// ---------------------------------------------------------------------------

describe('Riichi scoring', () => {
  it('scores pinfu + tanyao as 2 han 20 fu, 1300 from the discarder', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
      'pin2', 'pin3', 'pin4',
      'sou6', 'sou7', 'sou8',
      'sou5', 'sou5',
    ];
    const result = scoreHand(hand(tiles, 'man4'), RIICHI);

    expect(result.valid).toBe(true);
    expect(patternIds(result)).toEqual(expect.arrayContaining(['pinfu', 'all-simples']));
    expect(result.total).toBe(2);
    expect(result.fu?.total).toBe(20);
    expect(result.settlement?.winnerReceives).toBe(1300);
  });

  it('scores riichi + tsumo + pinfu + tanyao as 4 han 20 fu, 1300/2600', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
      'pin2', 'pin3', 'pin4',
      'sou6', 'sou7', 'sou8',
      'sou5', 'sou5',
    ];
    const result = scoreHand(
      hand(tiles, 'man4', { context: { selfDrawn: true, riichi: true } }),
      RIICHI,
    );

    // riichi 1 + menzen tsumo 1 + pinfu 1 + tanyao 1.
    expect(result.total).toBe(4);
    expect(result.fu?.total).toBe(20);
    // 20 fu x 2^6 = 1280 base: the dealer pays 2600, the other two 1300 each.
    expect(result.settlement?.winnerReceives).toBe(5200);
  });

  it('accumulates fu from concealed terminal triplets, an honour pair and a closed wait', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1',
      'pin9', 'pin9', 'pin9',
      'sou2', 'sou3', 'sou4',
      'sou6', 'sou7', 'sou8',
      'red', 'red',
    ];
    // Riichi is declared because the hand has no other yaku - terminal
    // triplets rule out tanyao, and two runs rule out toitoi.
    const result = scoreHand(hand(tiles, 'sou7', { context: { riichi: true } }), RIICHI);
    // 20 base + 10 menzen ron + 8 + 8 concealed terminal triplets
    //  + 2 dragon pair + 2 closed wait = 50
    expect(result.fu?.total).toBe(50);
  });

  it('refuses a complete hand that contains no yaku', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4',
      'pin5', 'pin6', 'pin7',
      'sou1', 'sou2', 'sou3',
      'west', 'west', 'west',
      'north', 'north',
    ];
    const melds: Meld[] = [];
    const result = scoreHand(hand(tiles, 'sou3', { melds }), RIICHI);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no yaku/i);
  });

  it('treats four concealed triplets as a yakuman worth 32000 to a non-dealer', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1',
      'pin9', 'pin9', 'pin9',
      'sou5', 'sou5', 'sou5',
      'west', 'west', 'west',
      'red', 'red',
    ];
    const result = scoreHand(hand(tiles, 'red', { context: { selfDrawn: true } }), RIICHI);
    expect(result.limitName).toBe('Yakuman');
    expect(result.settlement?.winnerReceives).toBe(32000);
  });

  it('halves an open half flush and still scores it', () => {
    const melds: Meld[] = [{ kind: 'pung', tiles: ['green', 'green', 'green'], concealed: false }];
    const tiles: TileCode[] = [
      'sou1', 'sou2', 'sou3',
      'sou4', 'sou5', 'sou6',
      'sou7', 'sou8', 'sou9',
      'sou2', 'sou2',
    ];
    const result = scoreHand(hand(tiles, 'sou9', { melds }), RIICHI);
    const halfFlush = result.patterns.find((p) => p.id === 'half-flush');
    expect(halfFlush?.unitValue).toBe(2); // 3 closed, 2 open
  });
});

// ---------------------------------------------------------------------------
// Non-repeat principle
// ---------------------------------------------------------------------------

describe('pattern supersession', () => {
  it('does not score Dragon Pung alongside Big Three Dragons', () => {
    const tiles: TileCode[] = [
      'red', 'red', 'red',
      'green', 'green', 'green',
      'white', 'white', 'white',
      'man2', 'man3', 'man4',
      'pin5', 'pin5',
    ];
    const result = scoreHand(hand(tiles, 'man4'), CHINESE_OFFICIAL);
    expect(patternIds(result)).toContain('big-three-dragons');
    expect(patternIds(result)).not.toContain('dragon-pung');
    expect(patternIds(result)).not.toContain('two-dragon-pungs');
  });

  it('does not score All Pungs alongside Four Concealed Pungs', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1',
      'pin9', 'pin9', 'pin9',
      'sou5', 'sou5', 'sou5',
      'west', 'west', 'west',
      'red', 'red',
    ];
    const result = scoreHand(hand(tiles, 'red', { context: { selfDrawn: true } }), CHINESE_OFFICIAL);
    expect(patternIds(result)).toContain('four-concealed-pungs');
    expect(patternIds(result)).not.toContain('all-pungs');
  });
});

// ---------------------------------------------------------------------------
// Hong Kong
// ---------------------------------------------------------------------------

describe('Hong Kong Old Style', () => {
  it('doubles faan into the points table and splits the discard payment', () => {
    // All Pungs (3) + Half Flush (3) = 6 faan -> 16 points.
    const tiles: TileCode[] = [
      'sou1', 'sou1', 'sou1',
      'sou5', 'sou5', 'sou5',
      'sou9', 'sou9', 'sou9',
      'east', 'east', 'east',
      'red', 'red',
    ];
    const result = scoreHand(hand(tiles, 'red'), HONG_KONG_OLD_STYLE);
    expect(result.valid).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(6);
    // Discarder pays double, the other two pay the base amount each.
    const discarder = result.settlement?.payments.find((p) => p.from === 'discarder');
    const others = result.settlement?.payments.find((p) => p.from === 'each-opponent');
    expect(discarder!.amount).toBe(others!.amount * 2);
  });

  it('blocks a cheap hand under the three-faan minimum but allows it without one', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4',
      'pin5', 'pin6', 'pin7',
      'sou1', 'sou2', 'sou3',
      'sou6', 'sou7', 'sou8',
      'north', 'north',
    ];
    const cheap = hand(tiles, 'sou8');
    expect(scoreHand(cheap, HONG_KONG_OLD_STYLE).valid).toBe(true);

    const blocked = scoreHand(cheap, HONG_KONG_THREE_FAAN);
    expect(blocked.valid).toBe(false);
    expect(blocked.reason).toMatch(/minimum/i);
  });

  it('pays a limit hand the top of the table regardless of accumulated faan', () => {
    const tiles: TileCode[] = [
      'red', 'red', 'red',
      'green', 'green', 'green',
      'white', 'white', 'white',
      'man2', 'man3', 'man4',
      'pin5', 'pin5',
    ];
    const result = scoreHand(hand(tiles, 'man4'), HONG_KONG_OLD_STYLE);
    expect(result.limitName).toBe('Limit hand');
    // Limit is 64; discarder pays double plus two others at 64.
    expect(result.settlement?.winnerReceives).toBe(64 * 2 + 64 * 2);
  });
});

// ---------------------------------------------------------------------------
// Taiwanese
// ---------------------------------------------------------------------------

describe('Taiwanese', () => {
  const sixteen: TileCode[] = [
    'man1', 'man2', 'man3',
    'man4', 'man5', 'man6',
    'pin1', 'pin2', 'pin3',
    'sou7', 'sou8', 'sou9',
    'east', 'east', 'east',
    'red', 'red',
  ];

  it('scores a seventeen-tile winning hand', () => {
    const result = scoreHand(hand(sixteen, 'red'), TAIWANESE_COMMON);
    expect(result.valid).toBe(true);
    expect(result.reading?.melds.filter((m) => m.kind !== 'pair')).toHaveLength(5);
  });

  it('counts one tai per bonus tile and pays the discarder alone', () => {
    const result = scoreHand(
      hand(sixteen, 'red', { bonus: ['flower_plum', 'season_spring'] }),
      TAIWANESE_COMMON,
    );
    const flowers = result.patterns.find((p) => p.id === 'flower-tiles');
    expect(flowers?.count).toBe(2);
    expect(flowers?.total).toBe(2);
    expect(result.settlement?.payments).toHaveLength(1);
    expect(result.settlement?.payments[0].from).toBe('discarder');
  });

  it('charges all three opponents on a self-drawn win', () => {
    const result = scoreHand(hand(sixteen, 'red', { context: { selfDrawn: true } }), TAIWANESE_COMMON);
    expect(result.settlement?.payments[0].from).toBe('each-opponent');
    expect(result.settlement?.winnerReceives).toBe(result.settlement!.payments[0].amount * 3);
  });

  it('applies base plus per-tai rate to the settlement', () => {
    const result = scoreHand(hand(sixteen, 'red'), TAIWANESE_COMMON);
    const expected = 30 + result.total * 10;
    expect(result.settlement?.winnerReceives).toBe(expected);
  });

  it('rejects a hand that is one tile short', () => {
    const short = sixteen.slice(0, 16);
    const result = scoreHand(hand(short, 'red'), TAIWANESE_COMMON);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/do not form a complete hand/i);
  });
});

// ---------------------------------------------------------------------------
// Chinese Official
// ---------------------------------------------------------------------------

describe('Chinese Official', () => {
  it('enforces the eight-point minimum before flowers', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4',
      'pin5', 'pin6', 'pin7',
      'sou1', 'sou2', 'sou3',
      'sou6', 'sou7', 'sou8',
      'north', 'north',
    ];
    const result = scoreHand(
      hand(tiles, 'sou8', { bonus: ['flower_plum', 'flower_orchid', 'season_spring'] }),
      CHINESE_OFFICIAL,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/before flowers/i);
  });

  it('settles a self-drawn win as three payments of value plus eight', () => {
    const tiles: TileCode[] = [
      'sou1', 'sou2', 'sou3',
      'sou4', 'sou5', 'sou6',
      'sou7', 'sou8', 'sou9',
      'sou2', 'sou3', 'sou4',
      'sou5', 'sou5',
    ];
    const result = scoreHand(hand(tiles, 'sou5', { context: { selfDrawn: true } }), CHINESE_OFFICIAL);
    expect(result.valid).toBe(true);
    const each = result.settlement!.payments[0].amount;
    expect(each).toBe(result.total + 8);
    expect(result.settlement?.winnerReceives).toBe(each * 3);
  });

  it('awards Chicken Hand only when nothing else scores', () => {
    const tiles: TileCode[] = [
      'man2', 'man3', 'man4',
      'pin5', 'pin6', 'pin7',
      'sou1', 'sou2', 'sou3',
      'sou6', 'sou7', 'sou8',
      'north', 'north',
    ];
    const rich = scoreHand(hand(tiles, 'sou8'), CHINESE_OFFICIAL);
    // This hand does score other elements (All Chows, waits), so no Chicken Hand.
    expect(patternIds(rich)).not.toContain('chicken-hand');
  });
});
