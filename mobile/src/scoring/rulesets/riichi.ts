import type { RuleSet } from './types';

/**
 * Japanese Riichi.
 *
 * The outlier among the four. Riichi is the only variant here that refuses to
 * score a hand at all unless it contains a named yaku - a complete, legal hand
 * of four runs and a pair with nothing else going for it simply cannot be
 * declared. It is also the only one that scores in two currencies at once: han
 * doubles the value, fu sets what is being doubled, and the two combine through
 * a table with hard ceilings at mangan and above.
 *
 * Many yaku are worth less, or nothing, once the hand has claimed a discard,
 * which `openValue` and `concealedOnly` encode. Riichi uses no flowers.
 */

const patterns: RuleSet['patterns'] = {
  // 1 han
  riichi: { value: 1, concealedOnly: true },
  'double-riichi': { value: 2, concealedOnly: true },
  ippatsu: { value: 1, concealedOnly: true },
  'fully-concealed-hand': { value: 1, concealedOnly: true },
  pinfu: { value: 1, concealedOnly: true },
  'pure-double-chow': { value: 1, concealedOnly: true },
  'all-simples': { value: 1, openValue: 1 },
  'dragon-pung': { value: 1, openValue: 1 },
  'seat-wind-pung': { value: 1, openValue: 1 },
  'prevalent-wind-pung': { value: 1, openValue: 1 },
  'out-with-replacement-tile': { value: 1, openValue: 1 },
  'robbing-the-kong': { value: 1, openValue: 1 },
  'last-tile-draw': { value: 1, openValue: 1 },
  'last-tile-claim': { value: 1, openValue: 1 },

  // 2 han
  'seven-pairs': { value: 2, concealedOnly: true },
  'all-pungs': { value: 2, openValue: 2 },
  'three-concealed-pungs': { value: 2, openValue: 2 },
  'triple-pung': { value: 2, openValue: 2 },
  'three-kongs': { value: 2, openValue: 2 },
  'all-terminals-and-honours': { value: 2, openValue: 2 },
  'little-three-dragons': { value: 2, openValue: 2 },
  'outside-hand': { value: 2, openValue: 1 },
  'mixed-triple-chow': { value: 2, openValue: 1 },
  'pure-straight': { value: 2, openValue: 1 },

  // 3 han
  'twice-pure-double-chow': { value: 3, concealedOnly: true },
  'fully-outside-hand': { value: 3, openValue: 2 },
  'half-flush': { value: 3, openValue: 2 },

  // 6 han
  'full-flush': { value: 6, openValue: 5 },

  // Yakuman
  'thirteen-orphans': { value: 0, limit: 1, concealedOnly: true },
  'four-concealed-pungs': { value: 0, limit: 1, concealedOnly: true },
  'big-three-dragons': { value: 0, limit: 1 },
  'little-four-winds': { value: 0, limit: 1 },
  'big-four-winds': { value: 0, limit: 2 },
  'all-honours': { value: 0, limit: 1 },
  'all-terminals': { value: 0, limit: 1 },
  'all-green': { value: 0, limit: 1 },
  'nine-gates': { value: 0, limit: 1, concealedOnly: true },
  'four-kongs': { value: 0, limit: 1 },
  'heavenly-hand': { value: 0, limit: 1, concealedOnly: true },
  'earthly-hand': { value: 0, limit: 1, concealedOnly: true },
};

export const RIICHI: RuleSet = {
  id: 'riichi',
  name: 'Japanese Riichi',
  subtitle: '13 tiles · han and fu, yaku required',
  family: 'riichi',
  handSize: 13,
  usesBonusTiles: false,
  allowSevenPairs: true,
  allowThirteenOrphans: true,
  requiresYaku: true,
  patterns,
  payout: {
    model: 'riichi',
    kiriageMangan: false,
    honbaValue: 300,
  },
  builtIn: true,
  notes:
    'A hand needs at least one yaku to be declared; situational bonuses such as ' +
    'dora do not count toward that. Han and fu combine into base points, which ' +
    'the dealer collects at six times and everyone else at four, rounded up to ' +
    'the nearest hundred, with hard ceilings at mangan, haneman, baiman and ' +
    'sanbaiman. Riichi uses no flowers or seasons.',
};

export const RIICHI_RULESETS = [RIICHI];
