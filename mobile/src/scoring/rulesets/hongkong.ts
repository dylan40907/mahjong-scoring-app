import type { FaanPayout, RuleSet } from './types';

/**
 * Hong Kong Old Style, the 13-tile game most people outside Japan have met.
 *
 * Scoring counts faan, and faan doubles into points along a table that
 * deliberately flattens near the top: past a certain point every big hand pays
 * the same limit, which keeps a single catastrophic hand from ending the
 * session. The doubling is why the faan numbers look so small next to
 * Taiwanese tai - three faan is already eight times a one-faan hand.
 *
 * The minimum-faan rule matters more than it looks. At a three-faan minimum a
 * hand of nothing but runs and a wind pair cannot be declared at all, which
 * pushes play toward flushes and triplets. Two presets ship for that reason.
 */

const HK_TABLE = [
  { faan: 0, points: 1 },
  { faan: 1, points: 2 },
  { faan: 2, points: 4 },
  { faan: 3, points: 8 },
  { faan: 4, points: 16 },
  { faan: 7, points: 32 },
  { faan: 10, points: 64 },
] as const;

const BASE_PAYOUT: FaanPayout = {
  model: 'faan',
  minimumFaan: 0,
  table: HK_TABLE,
  discardPaysDouble: true,
  nonDiscardersPay: true,
};

const patterns: RuleSet['patterns'] = {
  // 1 faan
  'no-flowers': { value: 1 },
  'seat-flower': { value: 1 },
  'seat-season': { value: 1 },
  'all-chows': { value: 1 },
  'dragon-pung': { value: 1 },
  'seat-wind-pung': { value: 1 },
  'prevalent-wind-pung': { value: 1 },
  'self-drawn': { value: 1 },
  'last-tile-draw': { value: 1 },
  'last-tile-claim': { value: 1 },
  'robbing-the-kong': { value: 1 },
  'out-with-replacement-tile': { value: 1 },

  // 2 faan
  'all-flowers': { value: 2 },
  'all-seasons': { value: 2 },

  // 3 faan
  'all-pungs': { value: 3 },
  'half-flush': { value: 3 },

  // 4 faan
  'little-three-dragons': { value: 4 },
  'seven-pairs': { value: 4 },

  // 6 faan
  'full-flush': { value: 6 },

  // Limit hands. In Old Style these all pay the table maximum rather than
  // accumulating faan, which is what `limit` expresses.
  'four-concealed-pungs': { value: 0, limit: 1 },
  'big-three-dragons': { value: 0, limit: 1 },
  'little-four-winds': { value: 0, limit: 1 },
  'big-four-winds': { value: 0, limit: 1 },
  'all-honours': { value: 0, limit: 1 },
  'all-terminals': { value: 0, limit: 1 },
  'nine-gates': { value: 0, limit: 1 },
  'thirteen-orphans': { value: 0, limit: 1 },
  'four-kongs': { value: 0, limit: 1 },
  'all-green': { value: 0, limit: 1 },
  'heavenly-hand': { value: 0, limit: 1 },
  'earthly-hand': { value: 0, limit: 1 },
};

export const HONG_KONG_OLD_STYLE: RuleSet = {
  id: 'hongkong-old-style',
  name: 'Hong Kong Old Style',
  subtitle: '13 tiles · faan doubling, no minimum',
  family: 'hongkong',
  handSize: 13,
  usesBonusTiles: true,
  allowSevenPairs: true,
  allowThirteenOrphans: true,
  requiresYaku: false,
  patterns,
  payout: BASE_PAYOUT,
  builtIn: true,
  notes:
    'Any hand can be declared. On a self-drawn win all three opponents pay ' +
    'double; on a discard the discarder pays double and the other two pay the ' +
    'base amount. Limit hands pay the top of the table outright rather than ' +
    'accumulating faan.',
};

export const HONG_KONG_THREE_FAAN: RuleSet = {
  ...HONG_KONG_OLD_STYLE,
  id: 'hongkong-three-faan',
  name: 'Hong Kong (3 Faan Minimum)',
  subtitle: '13 tiles · cheap hands cannot be declared',
  payout: { ...BASE_PAYOUT, minimumFaan: 3 },
  notes:
    'The same table with a three-faan floor, which is how most Hong Kong games ' +
    'are actually played. A hand that scores less cannot be declared at all, so ' +
    'flowers and situational faan stop being enough on their own and play pushes ' +
    'toward flushes, triplets and dragon sets.',
};

export const HONG_KONG_RULESETS = [HONG_KONG_OLD_STYLE, HONG_KONG_THREE_FAAN];
