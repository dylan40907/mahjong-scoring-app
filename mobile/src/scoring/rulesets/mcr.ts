import type { RuleSet } from './types';

/**
 * Chinese Official rules - Mahjong Competition Rules, the tournament standard.
 *
 * Eighty-one named scoring elements on a fixed point scale, and a hand must
 * reach eight points excluding flowers before it can be declared. Unlike the
 * doubling systems, MCR simply adds: a hand is worth the sum of every element
 * it contains, subject to a non-repeat principle that stops the same tiles
 * being sold twice. That principle is expressed here through the pattern
 * library's `supersedes` links - Big Three Dragons absorbs the Dragon Pungs it
 * is made of, rather than scoring alongside them.
 *
 * Values below follow the official table. Elements that depend on information
 * the app cannot see from a photograph - the knitted-tile families, which need
 * the full discard record - are omitted rather than approximated.
 */

const patterns: RuleSet['patterns'] = {
  // 88
  'big-four-winds': { value: 88 },
  'big-three-dragons': { value: 88 },
  'all-green': { value: 88 },
  'nine-gates': { value: 88 },
  'four-kongs': { value: 88 },
  'seven-shifted-pairs': { value: 88 },
  'thirteen-orphans': { value: 88 },

  // 64
  'all-terminals': { value: 64 },
  'little-four-winds': { value: 64 },
  'little-three-dragons': { value: 64 },
  'all-honours': { value: 64 },
  'four-concealed-pungs': { value: 64 },
  'pure-terminal-chows': { value: 64 },

  // 48
  'quadruple-chow': { value: 48 },
  'four-shifted-pungs': { value: 48 },

  // 32
  'four-shifted-chows': { value: 32 },
  'three-kongs': { value: 32 },
  'all-terminals-and-honours': { value: 32 },

  // 24
  'seven-pairs': { value: 24 },
  'all-even-pungs': { value: 24 },
  'full-flush': { value: 24 },
  'pure-triple-chow': { value: 24 },
  'pure-shifted-pungs': { value: 24 },
  'upper-tiles': { value: 24 },
  'middle-tiles': { value: 24 },
  'lower-tiles': { value: 24 },

  // 16
  'pure-straight': { value: 16 },
  'three-suited-terminal-chows': { value: 16 },
  'pure-shifted-chows': { value: 16 },
  'all-fives': { value: 16 },
  'triple-pung': { value: 16 },
  'three-concealed-pungs': { value: 16 },

  // 12
  'upper-four': { value: 12 },
  'lower-four': { value: 12 },
  'big-three-winds': { value: 12 },

  // 8
  'mixed-straight': { value: 8 },
  'reversible-tiles': { value: 8 },
  'mixed-triple-chow': { value: 8 },
  'mixed-shifted-pungs': { value: 8 },
  'chicken-hand': { value: 8 },
  'last-tile-draw': { value: 8 },
  'last-tile-claim': { value: 8 },
  'out-with-replacement-tile': { value: 8 },
  'robbing-the-kong': { value: 8 },
  'two-concealed-kongs': { value: 8 },

  // 6
  'all-pungs': { value: 6 },
  'half-flush': { value: 6 },
  'mixed-shifted-chows': { value: 6 },
  'all-types': { value: 6 },
  'melded-hand': { value: 6 },
  'two-dragon-pungs': { value: 6 },

  // 4
  'outside-hand': { value: 4 },
  'fully-concealed-hand': { value: 4 },
  'two-melded-kongs': { value: 4 },
  'last-tile': { value: 4 },

  // 2
  'dragon-pung': { value: 2 },
  'prevalent-wind-pung': { value: 2 },
  'seat-wind-pung': { value: 2 },
  'concealed-hand': { value: 2 },
  'all-chows': { value: 2 },
  'tile-hog': { value: 2 },
  'double-pung': { value: 2 },
  'two-concealed-pungs': { value: 2 },
  'concealed-kong': { value: 2 },
  'all-simples': { value: 2 },

  // 1
  'pure-double-chow': { value: 1 },
  'mixed-double-chow': { value: 1 },
  'short-straight': { value: 1 },
  'two-terminal-chows': { value: 1 },
  'pung-of-terminals-or-honours': { value: 1 },
  'melded-kong': { value: 1 },
  'one-voided-suit': { value: 1 },
  'no-honours': { value: 1 },
  'edge-wait': { value: 1 },
  'closed-wait': { value: 1 },
  'single-wait': { value: 1 },
  'self-drawn': { value: 1 },
  'flower-tiles': { value: 1 },
};

export const CHINESE_OFFICIAL: RuleSet = {
  id: 'mcr',
  name: 'Chinese Official',
  subtitle: '13 tiles · MCR tournament rules, 8-point minimum',
  family: 'mcr',
  handSize: 13,
  usesBonusTiles: true,
  allowSevenPairs: true,
  allowThirteenOrphans: true,
  requiresYaku: false,
  patterns,
  payout: {
    model: 'mcr',
    minimumPoints: 8,
    basePerPlayer: 8,
  },
  builtIn: true,
  notes:
    'A hand must be worth at least eight points before flowers to be declared. ' +
    'On a self-drawn win each opponent pays the hand value plus eight; on a ' +
    'discard the discarder pays the hand value plus eight and the other two pay ' +
    'eight each. The knitted-tile elements are not detected, since they depend ' +
    'on information a photograph of the hand does not carry.',
};

export const MCR_RULESETS = [CHINESE_OFFICIAL];
