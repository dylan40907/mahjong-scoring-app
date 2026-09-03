import type { RuleSet } from './types';

/**
 * Taiwanese 16-tile mahjong.
 *
 * Hands are sixteen tiles - five sets and a pair - and scoring counts 台 (tai),
 * each worth a fixed stake, on top of a flat 底 (base) paid on any win. What
 * makes Taiwanese worth shipping as more than one preset is that the tai table
 * is genuinely local: the values below differ by a factor of four between the
 * table most people actually play and the published reference table, and both
 * are correct where they are played. Anyone whose table differs from both can
 * clone either one and edit the numbers.
 *
 * Payment follows the near-universal Taiwanese convention: a self-drawn win is
 * paid by all three opponents, while discarding into a hand (放槍) makes the
 * discarder pay the whole amount alone.
 */

const commonTable: RuleSet['patterns'] = {
  // Situational
  'self-drawn': { value: 1 },
  'concealed-hand': { value: 1 },
  'fully-concealed-hand': { value: 3 },
  'melded-hand': { value: 2 },
  'out-with-replacement-tile': { value: 1 },
  'robbing-the-kong': { value: 1 },
  'last-tile-draw': { value: 1 },
  'last-tile-claim': { value: 1 },
  'single-wait': { value: 1 },
  'edge-wait': { value: 1 },
  'closed-wait': { value: 1 },

  // Bonus tiles
  'flower-tiles': { value: 1 },
  'no-flowers': { value: 1 },
  'all-eight-bonus': { value: 8 },

  // Honours
  'dragon-pung': { value: 1 },
  'seat-wind-pung': { value: 1 },
  'prevalent-wind-pung': { value: 1 },
  'little-three-dragons': { value: 4 },
  'big-three-dragons': { value: 8 },
  'little-four-winds': { value: 8 },
  'big-four-winds': { value: 16 },
  'all-honours': { value: 8 },

  // Structure
  'all-chows': { value: 2 },
  'all-pungs': { value: 4 },
  'three-concealed-pungs': { value: 2 },
  'four-concealed-pungs': { value: 5 },
  'five-concealed-pungs': { value: 8 },
  'melded-kong': { value: 1 },
  'concealed-kong': { value: 2 },
  'eight-pairs-triplet': { value: 8 },

  // Suits
  'half-flush': { value: 4 },
  'full-flush': { value: 8 },
  'all-terminals-and-honours': { value: 8 },
  'all-terminals': { value: 16 },
  'all-green': { value: 16 },
  'pure-straight': { value: 2 },

  // Limit hands
  'heavenly-hand': { value: 16 },
  'earthly-hand': { value: 8 },
};

export const TAIWANESE_COMMON: RuleSet = {
  id: 'taiwanese-common',
  name: 'Taiwanese',
  subtitle: '16 tiles · the tai table most tables actually use',
  family: 'taiwanese',
  handSize: 16,
  usesBonusTiles: true,
  allowSevenPairs: true,
  allowThirteenOrphans: false,
  requiresYaku: false,
  patterns: commonTable,
  payout: {
    model: 'tai',
    base: 30,
    perTai: 10,
    maxTai: 0,
    discardPayer: 'discarder-alone',
    dealerMultiplier: 1,
    // 連N拉N: one tai for dealing, two more for every repeat. The dealer
    // collects it on a win and pays it on a loss, which is what makes a long
    // streak worth being frightened of.
    dealerTai: 1,
    streakTai: 2,
  },
  builtIn: true,
  notes:
    'The everyday Taiwanese table. A win pays the 底 plus one stake per 台. ' +
    'Self-draw is paid by all three opponents; discarding into a hand means ' +
    'paying for it alone. Tai values vary from table to table more than in any ' +
    'other variant here, so treat this as a starting point and clone it if your ' +
    'group counts differently.',
};

/**
 * The published Four Winds reference table.
 *
 * Substantially more generous than the common table, and includes several
 * patterns the common table ignores entirely. Kept as a separate preset rather
 * than folded in, because averaging two real rule tables produces a third that
 * nobody plays.
 */
const referenceTable: RuleSet['patterns'] = {
  'winning-hand': { value: 2 },
  'self-drawn': { value: 1 },
  'concealed-hand': { value: 1 },
  'fully-concealed-hand': { value: 3 },
  'melded-hand': { value: 10 },
  'robbing-the-kong': { value: 1 },
  'last-tile-draw': { value: 1 },
  'single-wait': { value: 1 },
  'edge-wait': { value: 1 },
  'closed-wait': { value: 1 },

  'flower-tiles': { value: 1 },
  'no-flowers': { value: 1 },
  'all-eight-bonus': { value: 30 },

  'dragon-pung': { value: 1 },
  'wind-pung': { value: 1 },
  'little-three-dragons': { value: 15 },
  'big-three-dragons': { value: 30 },
  'little-three-winds': { value: 5 },
  'big-three-winds': { value: 15 },
  'little-four-winds': { value: 30 },
  'big-four-winds': { value: 40 },

  'melded-kong': { value: 1 },
  'concealed-kong': { value: 2 },
  'two-concealed-pungs': { value: 2 },
  'three-concealed-pungs': { value: 5 },
  'four-concealed-pungs': { value: 15 },
  'five-concealed-pungs': { value: 40 },
  'pure-straight': { value: 5, concealedOnly: false },
  'all-chows': { value: 3 },
  'all-pungs': { value: 10 },
  'eight-pairs-triplet': { value: 30 },

  'no-honours': { value: 1 },
  'half-flush': { value: 10 },
  'full-flush': { value: 40 },

  'ready-on-deal': { value: 15 },
  'early-win-nine': { value: 5 },
  'early-win-five': { value: 10 },
  'heavenly-hand': { value: 40 },
  'earthly-hand': { value: 40 },
};

export const TAIWANESE_REFERENCE: RuleSet = {
  id: 'taiwanese-reference',
  name: 'Taiwanese (Reference Table)',
  subtitle: '16 tiles · the published Four Winds tai values',
  family: 'taiwanese',
  handSize: 16,
  usesBonusTiles: true,
  allowSevenPairs: true,
  allowThirteenOrphans: false,
  requiresYaku: false,
  patterns: referenceTable,
  payout: {
    model: 'tai',
    base: 30,
    perTai: 10,
    maxTai: 40,
    discardPayer: 'discarder-alone',
    dealerMultiplier: 1,
    // 連N拉N: one tai for dealing, two more for every repeat. The dealer
    // collects it on a win and pays it on a loss, which is what makes a long
    // streak worth being frightened of.
    dealerTai: 1,
    streakTai: 2,
  },
  builtIn: true,
  notes:
    'The Four Winds published reference table, which awards noticeably more tai ' +
    'than an ordinary table and recognises several patterns the common table ' +
    'does not - early wins, readiness on the deal, and a two-concealed-triplet ' +
    'bonus. Capped at 40 tai, as the reference suggests.',
};

export const TAIWANESE_RULESETS = [TAIWANESE_COMMON, TAIWANESE_REFERENCE];
