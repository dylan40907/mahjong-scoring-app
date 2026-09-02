import type { TileCode } from '@/tiles/tileset';
import type { HandContext, HandInput } from '../hand';
import { decompose } from '../decompose';
import { buildContext } from '../patterns/context';
import { matchesCustomHand, type CustomHand, type HandRequirement } from '../patterns/custom';
import { scoreHand } from '../score';
import { TAIWANESE_COMMON, type RuleSet } from '../rulesets';

/**
 * Hands a table made up.
 *
 * The bar these have to clear is that somebody can rebuild a pattern the app
 * already ships without writing code - so most of these are built-in patterns
 * described from the outside, checked against hands that do and do not match.
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
  options: { exposed?: TileCode[]; context?: Partial<HandContext> } = {},
): HandInput {
  return {
    concealed,
    exposed: options.exposed ?? [],
    bonus: [],
    winningTile,
    context: { ...defaults, ...options.context },
  };
}

const made = (requirements: HandRequirement[]): CustomHand => ({
  id: 'custom:test',
  name: 'Test Hand',
  description: 'Made up for this test.',
  requirements,
});

/** True when any reading of the hand satisfies the custom hand. */
function matches(input: HandInput, custom: CustomHand, handSize = 13): boolean {
  return decompose(input, { handSize }).some((reading) =>
    matchesCustomHand(custom, buildContext(input, reading, handSize)),
  );
}

const ALL_PUNGS: TileCode[] = [
  'man2', 'man2', 'man2',
  'pin5', 'pin5', 'pin5',
  'sou8', 'sou8', 'sou8',
  'east', 'east', 'east',
  'red', 'red',
];

const ALL_CHOWS: TileCode[] = [
  'man1', 'man2', 'man3',
  'man4', 'man5', 'man6',
  'pin2', 'pin3', 'pin4',
  'sou5', 'sou6', 'sou7',
  'red', 'red',
];

describe('set counts', () => {
  it('rebuilds All Pungs', () => {
    const custom = made([{ kind: 'sets', of: 'pung', atLeast: 4 }]);
    expect(matches(hand(ALL_PUNGS, 'red'), custom)).toBe(true);
    expect(matches(hand(ALL_CHOWS, 'red'), custom)).toBe(false);
  });

  it('counts a kong as a triplet, the way every ruleset here does', () => {
    const kongHand: TileCode[] = [
      'man2', 'man2', 'man2', 'man2',
      'pin5', 'pin5', 'pin5',
      'sou8', 'sou8', 'sou8',
      'east', 'east', 'east',
      'red', 'red',
    ];
    expect(matches(hand(kongHand, 'red'), made([{ kind: 'sets', of: 'pung', atLeast: 4 }]))).toBe(true);
    expect(matches(hand(kongHand, 'red'), made([{ kind: 'sets', of: 'kong', atLeast: 1 }]))).toBe(true);
  });

  it('tells "exactly" from "at least"', () => {
    expect(matches(hand(ALL_CHOWS, 'red'), made([{ kind: 'sets', of: 'chow', atLeast: 4, exactly: true }]))).toBe(true);
    expect(matches(hand(ALL_CHOWS, 'red'), made([{ kind: 'sets', of: 'chow', atLeast: 3, exactly: true }]))).toBe(false);
    expect(matches(hand(ALL_CHOWS, 'red'), made([{ kind: 'sets', of: 'chow', atLeast: 3 }]))).toBe(true);
  });

  it('counts concealed sets only when nothing was melded', () => {
    const requirement: HandRequirement = { kind: 'sets', of: 'concealed-set', atLeast: 4 };
    expect(matches(hand(ALL_PUNGS, 'red'), made([requirement]))).toBe(true);
    const withMeld = hand(ALL_PUNGS.slice(3), 'red', { exposed: ['man2', 'man2', 'man2'] });
    expect(matches(withMeld, made([requirement]))).toBe(false);
  });
});

describe('suits and tile families', () => {
  const flush: TileCode[] = [
    'man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'man7', 'man8', 'man9',
    'man1', 'man1', 'man1', 'man5', 'man5',
  ];

  it('rebuilds Full Flush', () => {
    const custom = made([{ kind: 'suits', rule: 'single-suit' }]);
    expect(matches(hand(flush, 'man5'), custom)).toBe(true);
    expect(matches(hand(ALL_CHOWS, 'red'), custom)).toBe(false);
  });

  it('separates a pure flush from one carrying honours', () => {
    const halfFlush: TileCode[] = [
      'man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'man7', 'man8', 'man9',
      'east', 'east', 'east', 'red', 'red',
    ];
    expect(matches(hand(halfFlush, 'red'), made([{ kind: 'suits', rule: 'single-suit' }]))).toBe(false);
    expect(matches(hand(halfFlush, 'red'), made([{ kind: 'suits', rule: 'single-suit-plus-honours' }]))).toBe(true);
  });

  it('rebuilds All Simples', () => {
    const custom = made([{ kind: 'tiles', family: 'terminal-or-honour', scope: 'none' }]);
    expect(matches(hand(ALL_PUNGS, 'red'), custom)).toBe(false);
    const simples: TileCode[] = [
      'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
      'pin3', 'pin4', 'pin5', 'sou6', 'sou7', 'sou8', 'sou5', 'sou5',
    ];
    expect(matches(hand(simples, 'sou5'), custom)).toBe(true);
  });

  it('rebuilds All Green', () => {
    const green: TileCode[] = [
      'sou2', 'sou3', 'sou4', 'sou6', 'sou6', 'sou6', 'sou8', 'sou8', 'sou8',
      'green', 'green', 'green', 'sou2', 'sou2',
    ];
    const custom = made([{ kind: 'tiles', family: 'green', scope: 'every' }]);
    expect(matches(hand(green, 'sou2'), custom)).toBe(true);
    expect(matches(hand(ALL_CHOWS, 'red'), custom)).toBe(false);
  });
});

describe('specific tiles', () => {
  it('rebuilds Big Three Dragons', () => {
    const dragons: TileCode[] = [
      'red', 'red', 'red', 'green', 'green', 'green', 'white', 'white', 'white',
      'man1', 'man2', 'man3', 'sou5', 'sou5',
    ];
    const custom = made([
      { kind: 'triplet-of', tiles: ['red', 'green', 'white'], mode: 'all' },
    ]);
    expect(matches(hand(dragons, 'sou5'), custom)).toBe(true);
    expect(matches(hand(ALL_PUNGS, 'red'), custom)).toBe(false);
  });

  it('counts repeats in a contains requirement', () => {
    const custom = made([{ kind: 'contains', tiles: ['east', 'east', 'east'] }]);
    expect(matches(hand(ALL_PUNGS, 'red'), custom)).toBe(true);
    expect(matches(hand(ALL_PUNGS, 'red'), made([{ kind: 'contains', tiles: ['west'] }]))).toBe(false);
  });
});

describe('the pair and how it was won', () => {
  it('reads the pair', () => {
    expect(matches(hand(ALL_PUNGS, 'red'), made([{ kind: 'pair-is', rule: 'dragon' }]))).toBe(true);
    expect(matches(hand(ALL_PUNGS, 'red'), made([{ kind: 'pair-is', rule: 'wind' }]))).toBe(false);
  });

  it('reads the seat wind rather than a fixed one', () => {
    const seated: TileCode[] = [
      'man1', 'man2', 'man3', 'man4', 'man5', 'man6',
      'pin2', 'pin3', 'pin4', 'sou7', 'sou8', 'sou9', 'south', 'south',
    ];
    const custom = made([{ kind: 'pair-is', rule: 'seat-wind' }]);
    expect(matches(hand(seated, 'south', { context: { seatWind: 'south' } }), custom)).toBe(true);
    expect(matches(hand(seated, 'south', { context: { seatWind: 'east' } }), custom)).toBe(false);
  });

  it('reads how the last tile arrived', () => {
    const drawn = hand(ALL_PUNGS, 'red', { context: { selfDrawn: true } });
    expect(matches(drawn, made([{ kind: 'won', how: 'self-drawn' }]))).toBe(true);
    expect(matches(drawn, made([{ kind: 'won', how: 'discard' }]))).toBe(false);
  });
});

describe('requirements combine', () => {
  it('needs every one of them to hold', () => {
    const custom = made([
      { kind: 'sets', of: 'pung', atLeast: 4 },
      { kind: 'pair-is', rule: 'dragon' },
      { kind: 'suits', rule: 'all-three-suits' },
    ]);
    expect(matches(hand(ALL_PUNGS, 'red'), custom)).toBe(true);

    const twoSuits: TileCode[] = [
      'man2', 'man2', 'man2', 'man5', 'man5', 'man5',
      'pin8', 'pin8', 'pin8', 'east', 'east', 'east', 'red', 'red',
    ];
    expect(matches(hand(twoSuits, 'red'), custom)).toBe(false);
  });

  it('never scores a hand nobody finished describing', () => {
    expect(matches(hand(ALL_PUNGS, 'red'), made([]))).toBe(false);
  });
});

describe('scoring with a custom hand attached to a ruleset', () => {
  const custom: CustomHand = {
    id: 'custom:jade-gate',
    name: 'Jade Gate',
    description: "Our table's hand: all triplets, paired on a dragon.",
    requirements: [
      { kind: 'sets', of: 'pung', atLeast: 5 },
      { kind: 'pair-is', rule: 'dragon' },
    ],
  };

  const rules: RuleSet = {
    ...TAIWANESE_COMMON,
    id: 'custom-test',
    customHands: [custom],
    patterns: { ...TAIWANESE_COMMON.patterns, [custom.id]: { value: 12 } },
  };

  // Taiwanese: five triplets and a pair, seventeen tiles.
  const tiles: TileCode[] = [
    'man2', 'man2', 'man2', 'man5', 'man5', 'man5',
    'pin3', 'pin3', 'pin3', 'sou7', 'sou7', 'sou7',
    'east', 'east', 'east', 'red', 'red',
  ];

  it('scores as a pattern of its own', () => {
    const result = scoreHand(hand(tiles, 'red'), rules);
    expect(result.valid).toBe(true);
    const scored = result.patterns.find((p) => p.id === custom.id);
    expect(scored?.name).toBe('Jade Gate');
    expect(scored?.total).toBe(12);
  });

  it('is ignored by a ruleset that does not list it', () => {
    const result = scoreHand(hand(tiles, 'red'), TAIWANESE_COMMON);
    expect(result.patterns.some((p) => p.id === custom.id)).toBe(false);
  });

  it('can be turned off without being deleted', () => {
    const off: RuleSet = { ...rules, patterns: { ...TAIWANESE_COMMON.patterns } };
    const result = scoreHand(hand(tiles, 'red'), off);
    expect(result.patterns.some((p) => p.id === custom.id)).toBe(false);
  });
});
