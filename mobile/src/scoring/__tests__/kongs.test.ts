import type { TileCode } from '@/tiles/tileset';
import type { HandContext, HandInput } from '../hand';
import { decompose, kongsImpliedBy } from '../decompose';
import { scoreHand } from '../score';
import { CHINESE_OFFICIAL, HONG_KONG_OLD_STYLE, RIICHI, TAIWANESE_COMMON } from '../rulesets';

/**
 * Kongs, and the shapes that behave like them.
 *
 * A kong is four tiles doing the work of three, so a hand holding one is a
 * tile over the nominal size. Nothing declares them: four tiles in one bag
 * either parse as a kong or the hand does not parse at all, which is what
 * makes "eighteen tiles" an answer rather than a counting error. The app used
 * to refuse to score such a hand entirely, and then briefly made the player
 * declare each kong by hand - which had no honest answer for a concealed one,
 * since that is set down without ever being shown.
 */

const defaults: HandContext = {
  selfDrawn: false,
  seatWind: 'east',
  roundWind: 'east',
  isDealer: false,
};

function hand(
  concealed: TileCode[],
  winningTile: TileCode,
  options: { exposed?: TileCode[]; bonus?: TileCode[]; context?: Partial<HandContext> } = {},
): HandInput {
  return {
    concealed,
    exposed: options.exposed ?? [],
    bonus: options.bonus ?? [],
    winningTile,
    context: { ...defaults, ...options.context },
  };
}

/**
 * Four identical tiles, wherever they happen to be sitting.
 *
 * A melded kong is four tiles in `exposed`; a concealed kong is four tiles in
 * `concealed`, which is exactly how the player holds it.
 */
const four = (code: TileCode): TileCode[] => [code, code, code, code];

describe('kongsImpliedBy', () => {
  it('reads the surplus as the kong count', () => {
    expect(kongsImpliedBy(17, 16)).toBe(0);
    expect(kongsImpliedBy(18, 16)).toBe(1);
    expect(kongsImpliedBy(14, 13)).toBe(0);
    expect(kongsImpliedBy(16, 13)).toBe(2);
  });

  it('refuses a count no number of kongs could reach', () => {
    expect(kongsImpliedBy(13, 16)).toBeNull();
    // Thirteen tiles is four sets and a pair, so five kongs is one too many.
    expect(kongsImpliedBy(19, 13)).toBeNull();
  });
});

describe('a hand containing a kong', () => {
  const rest: TileCode[] = [
    'man1', 'man2', 'man3',
    'man4', 'man5', 'man6',
    'pin1', 'pin2', 'pin3',
    'sou1', 'sou2', 'sou3',
    'red', 'red',
  ];
  const melded = { exposed: four('east') };
  const held = [...rest, ...four('east')];

  it('reads as a complete Taiwanese hand at eighteen tiles', () => {
    expect(decompose(hand(rest, 'red', melded), { handSize: 16 }).length).toBeGreaterThan(0);
    expect(decompose(hand(held, 'red'), { handSize: 16 }).length).toBeGreaterThan(0);
  });

  it('scores, rather than being rejected for having a tile too many', () => {
    const result = scoreHand(hand(rest, 'red', melded), TAIWANESE_COMMON);
    expect(result.valid).toBe(true);
    expect(result.patterns.map((p) => p.id)).toContain('melded-kong');
  });

  it('finds a concealed kong without being told it is there', () => {
    const result = scoreHand(hand(held, 'red'), TAIWANESE_COMMON);
    expect(result.valid).toBe(true);
    expect(result.patterns.map((p) => p.id)).toContain('concealed-kong');
  });

  it('pays a concealed kong more than a melded one', () => {
    const open = scoreHand(hand(rest, 'red', melded), TAIWANESE_COMMON);
    const hidden = scoreHand(hand(held, 'red'), TAIWANESE_COMMON);
    expect(hidden.total).toBeGreaterThan(open.total);
  });

  it('leaves a hand concealed when the only kong was never shown', () => {
    const selfDrawn = { context: { selfDrawn: true } };
    const hidden = scoreHand(hand(held, 'red', selfDrawn), TAIWANESE_COMMON);
    expect(hidden.patterns.map((p) => p.id)).toContain('fully-concealed-hand');

    const open = scoreHand(hand(rest, 'red', { ...melded, ...selfDrawn }), TAIWANESE_COMMON);
    expect(open.patterns.map((p) => p.id)).not.toContain('fully-concealed-hand');
  });

  it('rejects a surplus tile that no kong can account for', () => {
    // Eighteen tiles, and not a four of a kind anywhere: not a hand, whatever
    // the count says.
    const broken: TileCode[] = [...rest, 'sou5', 'sou6', 'sou7', 'sou8'];
    expect(decompose(hand(broken, 'red'), { handSize: 16 })).toHaveLength(0);
  });
});

describe('Riichi fu for kongs', () => {
  // 13 + 1 + one kong = 15 tiles. A dragon kong, so the hand has a yaku either
  // way; riichi itself would not survive the melded case, and then there would
  // be nothing to compare.
  const rest: TileCode[] = [
    'man2', 'man3', 'man4',
    'man5', 'man6', 'man7',
    'pin3', 'pin4', 'pin5',
    'sou5', 'sou5',
  ];

  it('doubles an honour kong when it was never shown', () => {
    // Melded: 20 base + 16 kong + 2 single wait = 38, rounded to 40.
    // Concealed: 20 + 32 + 10 for a closed hand won on a discard + 2 = 64 → 70.
    const open = scoreHand(hand(rest, 'sou5', { exposed: four('red') }), RIICHI);
    const hidden = scoreHand(hand([...rest, ...four('red')], 'sou5'), RIICHI);
    expect(open.fu?.total).toBe(40);
    expect(hidden.fu?.total).toBe(70);
  });
});

describe('four kongs', () => {
  it('is a limit hand at eighteen tiles', () => {
    const result = scoreHand(
      hand(['red', 'red'], 'red', {
        exposed: [...four('east'), ...four('south'), ...four('west'), ...four('north')],
      }),
      CHINESE_OFFICIAL,
    );
    expect(result.valid).toBe(true);
    expect(result.patterns.map((p) => p.id)).toContain('four-kongs');
  });
});

describe('seven pairs', () => {
  it('will not read four identical tiles as two of its pairs', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man1', 'man1',
      'pin3', 'pin3', 'pin5', 'pin5',
      'sou2', 'sou2', 'sou7', 'sou7',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'red'), { handSize: 13 });
    expect(readings.every((reading) => reading.special !== 'seven-pairs')).toBe(true);
  });

  it('still reads seven different pairs', () => {
    const tiles: TileCode[] = [
      'man1', 'man1', 'man4', 'man4',
      'pin3', 'pin3', 'pin5', 'pin5',
      'sou2', 'sou2', 'sou7', 'sou7',
      'red', 'red',
    ];
    const readings = decompose(hand(tiles, 'red'), { handSize: 13 });
    expect(readings.some((reading) => reading.special === 'seven-pairs')).toBe(true);
  });
});

describe('melded and concealed tiles never share a set', () => {
  it('refuses a run made half from the table and half from the hand', () => {
    // pin1 pin2 on the table with pin3 still in hand is not a meld anybody
    // declared, and letting it count would invent an exposed run.
    const concealed: TileCode[] = [
      'pin3', 'man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'sou7', 'sou8', 'sou9', 'red', 'red',
    ];
    const readings = decompose(hand(concealed, 'red', { exposed: ['pin1', 'pin2'] }), {
      handSize: 13,
    });
    expect(readings).toHaveLength(0);
  });
});

describe('a winning tile that landed in a meld already on the table', () => {
  it('earns no wait bonus', () => {
    // Robbing a kong: the tile completes a pung somebody else had melded, so
    // there is no wait to classify and nothing to pay for one.
    const result = scoreHand(
      hand(
        ['man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'pin7', 'pin8', 'pin9', 'red', 'red'],
        'east',
        { exposed: ['east', 'east', 'east'], context: { robbingKong: true } },
      ),
      HONG_KONG_OLD_STYLE,
    );
    expect(result.reading?.waitType).toBe('none');
    expect(result.patterns.map((p) => p.id)).not.toContain('single-wait');
  });
});
