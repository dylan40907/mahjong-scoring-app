import type { TileCode } from '@/tiles/tileset';
import type { HandContext, HandInput, Meld } from '../hand';
import { decompose } from '../decompose';
import { scoreHand } from '../score';
import { CHINESE_OFFICIAL, HONG_KONG_OLD_STYLE, RIICHI, TAIWANESE_COMMON } from '../rulesets';

/**
 * Kongs, and the shapes that behave like them.
 *
 * A kong is four tiles standing in for a set of three, so a hand holding one
 * is a tile over the nominal size. Everything downstream of that - the tile
 * count the review screen checks, the reading the decomposer looks for, the
 * fu a Riichi hand earns - has to agree about it, and the app used to refuse
 * to score such a hand at all.
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

const kong = (code: TileCode, concealed: boolean): Meld => ({
  kind: 'kong',
  tiles: [code, code, code, code],
  concealed,
});

describe('a hand containing a kong', () => {
  const rest: TileCode[] = [
    'man1', 'man2', 'man3',
    'man4', 'man5', 'man6',
    'pin1', 'pin2', 'pin3',
    'sou1', 'sou2', 'sou3',
    'red', 'red',
  ];

  it('reads as a complete Taiwanese hand at eighteen tiles', () => {
    const readings = decompose(hand(rest, 'red', { melds: [kong('east', false)] }), {
      handSize: 16,
    });
    expect(readings.length).toBeGreaterThan(0);
  });

  it('scores, rather than being rejected for having a tile too many', () => {
    const result = scoreHand(
      hand(rest, 'red', { melds: [kong('east', false)] }),
      TAIWANESE_COMMON,
    );
    expect(result.valid).toBe(true);
    expect(result.patterns.map((p) => p.id)).toContain('melded-kong');
  });

  it('pays a concealed kong more than a melded one', () => {
    const melded = scoreHand(hand(rest, 'red', { melds: [kong('east', false)] }), TAIWANESE_COMMON);
    const hidden = scoreHand(hand(rest, 'red', { melds: [kong('east', true)] }), TAIWANESE_COMMON);
    expect(hidden.total).toBeGreaterThan(melded.total);
    expect(hidden.patterns.map((p) => p.id)).toContain('concealed-kong');
  });

  it('leaves a hand concealed when the only declaration was a concealed kong', () => {
    // A concealed kong is set down but never shown, so the hand is still a
    // concealed hand. Treating every declaration as exposed - which the app
    // used to have no way not to - quietly deleted this.
    const selfDrawn = { context: { selfDrawn: true } };
    const hidden = scoreHand(
      hand(rest, 'red', { melds: [kong('east', true)], ...selfDrawn }),
      TAIWANESE_COMMON,
    );
    expect(hidden.patterns.map((p) => p.id)).toContain('fully-concealed-hand');

    const melded = scoreHand(
      hand(rest, 'red', { melds: [kong('east', false)], ...selfDrawn }),
      TAIWANESE_COMMON,
    );
    expect(melded.patterns.map((p) => p.id)).not.toContain('fully-concealed-hand');
  });
});

describe('Riichi fu for kongs', () => {
  // 13 + 1 + one kong = 15 tiles.
  const rest: TileCode[] = [
    'man2', 'man3', 'man4',
    'man5', 'man6', 'man7',
    'pin3', 'pin4', 'pin5',
    'sou5', 'sou5',
  ];

  // A dragon kong so the hand has a yaku either way; riichi itself would not
  // survive the melded case, and then there would be nothing to compare.
  const fuFor = (concealed: boolean) =>
    scoreHand(hand(rest, 'sou5', { melds: [kong('red', concealed)] }), RIICHI).fu?.total;

  it('doubles an honour kong when it was concealed', () => {
    // Melded: 20 base + 16 kong + 2 single wait = 38, rounded to 40.
    // Concealed: 20 + 32 + 10 for a closed hand won on a discard + 2 = 64 → 70.
    expect(fuFor(false)).toBe(40);
    expect(fuFor(true)).toBe(70);
  });
});

describe('four kongs', () => {
  it('is a limit hand at eighteen tiles', () => {
    const result = scoreHand(
      hand(['red', 'red'], 'red', {
        melds: [
          kong('east', false),
          kong('south', false),
          kong('west', false),
          kong('north', false),
        ],
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

describe('a winning tile that landed in a meld already on the table', () => {
  it('earns no wait bonus', () => {
    // Robbing a kong: the tile completes a pung somebody else had melded, so
    // there is no wait to classify and nothing to pay for one.
    const result = scoreHand(
      hand(['man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'pin7', 'pin8', 'pin9', 'red', 'red'], 'east', {
        melds: [{ kind: 'pung', tiles: ['east', 'east', 'east'], concealed: false }],
        context: { robbingKong: true },
      }),
      HONG_KONG_OLD_STYLE,
    );
    expect(result.reading?.waitType).toBe('none');
    expect(result.patterns.map((p) => p.id)).not.toContain('single-wait');
  });
});
