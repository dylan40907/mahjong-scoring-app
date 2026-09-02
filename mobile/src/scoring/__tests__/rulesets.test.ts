import { BUILT_IN_RULESETS, PATTERNS, scoreHand } from '..';
import type { HandContext, HandInput, RuleSet } from '..';
import { NUM_CLASSES, TILES, CODES } from '@/tiles/tileset';
import type { TileCode } from '@/tiles/tileset';

/**
 * Integrity checks on the shipped rulesets.
 *
 * Rulesets refer to patterns by string id, which means a typo is invisible:
 * the pattern silently never scores and the hand comes out cheap. Nothing in
 * the type system catches it, so it is caught here instead.
 */

describe('ruleset integrity', () => {
  it.each(BUILT_IN_RULESETS.map((r) => [r.name, r] as [string, RuleSet]))(
    '%s references only patterns that exist',
    (_name, rules) => {
      const unknown = Object.keys(rules.patterns).filter((id) => !PATTERNS.has(id));
      expect(unknown).toEqual([]);
    },
  );

  it.each(BUILT_IN_RULESETS.map((r) => [r.name, r] as [string, RuleSet]))(
    '%s gives every pattern a usable value',
    (_name, rules) => {
      for (const [id, value] of Object.entries(rules.patterns)) {
        // A limit pattern carries its worth in `limit`; everything else needs a
        // positive value or it is a rule that can never do anything.
        if (value.limit !== undefined) {
          expect(value.limit).toBeGreaterThan(0);
        } else {
          expect({ id, value: value.value }).toEqual({ id, value: expect.any(Number) });
          expect(value.value).toBeGreaterThan(0);
        }
      }
    },
  );

  it('has unique ids', () => {
    const ids = BUILT_IN_RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses bonus-tile patterns where bonus tiles are in play', () => {
    const bonusPatterns = ['flower-tiles', 'seat-flower', 'seat-season', 'all-flowers', 'all-seasons'];
    for (const rules of BUILT_IN_RULESETS) {
      if (rules.usesBonusTiles) continue;
      const offenders = bonusPatterns.filter((id) => id in rules.patterns);
      expect({ ruleset: rules.name, offenders }).toEqual({ ruleset: rules.name, offenders: [] });
    }
  });

  it('sizes hands consistently with the sets they need', () => {
    for (const rules of BUILT_IN_RULESETS) {
      expect([13, 16]).toContain(rules.handSize);
      // (handSize - 1) / 3 sets plus a pair has to come out whole.
      expect((rules.handSize - 1) % 3).toBe(0);
    }
  });
});

describe('the tile set', () => {
  it('has 42 classes and 144 physical tiles', () => {
    expect(TILES).toHaveLength(42);
    expect(NUM_CLASSES).toBe(42);
    expect(TILES.reduce((sum, tile) => sum + tile.copies, 0)).toBe(144);
  });

  it('indexes classes in output order with no gaps', () => {
    TILES.forEach((tile, index) => expect(tile.index).toBe(index));
    expect(CODES).toHaveLength(42);
    expect(new Set(CODES).size).toBe(42);
  });

  it('gives every suit the right number of faces', () => {
    const counts = TILES.reduce<Record<string, number>>((acc, tile) => {
      acc[tile.suit] = (acc[tile.suit] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ man: 9, pin: 9, sou: 9, wind: 4, dragon: 3, flower: 4, season: 4 });
  });
});

/**
 * Every ruleset should be able to score its own simplest legal hand. This is a
 * smoke test against a whole ruleset being unreachable - a wrong hand size, an
 * impossible minimum - rather than against any particular value.
 */
describe('every ruleset scores a plain hand', () => {
  const thirteen: TileCode[] = [
    'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
    'pin2', 'pin3', 'pin4', 'sou6', 'sou7', 'sou8', 'sou5', 'sou5',
  ];
  const sixteen: TileCode[] = [
    'man2', 'man3', 'man4', 'man5', 'man6', 'man7',
    'pin2', 'pin3', 'pin4', 'pin5', 'pin6', 'pin7',
    'sou6', 'sou7', 'sou8', 'sou5', 'sou5',
  ];

  const context: HandContext = {
    selfDrawn: true,
    seatWind: 'east',
    roundWind: 'east',
    isDealer: false,
    riichi: true,
  };

  it.each(BUILT_IN_RULESETS.map((r) => [r.name, r] as [string, RuleSet]))(
    '%s produces a decomposition',
    (_name, rules) => {
      const concealed = rules.handSize === 16 ? sixteen : thirteen;
      const hand: HandInput = {
        concealed,
        exposed: [],
        bonus: [],
        winningTile: 'man4',
        context,
      };
      const result = scoreHand(hand, rules);
      // It may be below a minimum, which is a legitimate outcome; what must not
      // happen is failing to parse the tiles at all.
      expect(result.reading).not.toBeNull();
      expect(result.reason ?? '').not.toMatch(/do not form a complete hand/i);
    },
  );
});
