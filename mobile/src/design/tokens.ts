/**
 * The design system, in one file.
 *
 * Three deliberate constraints, each a reaction to how machine-generated
 * interfaces usually go wrong:
 *
 *   One accent. Brass appears on the primary action, on the score that the
 *   screen exists to show, and nowhere else. Everything else is built from
 *   the neutral ramp. Colour used as decoration stops working as signal.
 *
 *   The table is the single exception, and it is an exception about subject
 *   rather than about decoration: the session screen stands in for a physical
 *   table, so it is baize and wood. That palette is confined to the table and
 *   does not leak into the rest of the app.
 *
 *   No glow, no gradients. Depth comes from a four-step surface ramp and
 *   hairline rules. A dark interface does not need to look lit from within.
 *
 *   Dark only. A half-considered light theme reads worse than a committed
 *   dark one, and the subject is a table lit from above at night.
 *
 * The ramp is green, and not subtly. The subject is a game played on baize, and
 * a neutral near-black said nothing about it while making the whole app read as
 * a utility. Deep jade costs no legibility - the bone white of a tile face and
 * the brass of a score both gain contrast against it - and it means every
 * screen belongs to the same object without any screen having to decorate
 * itself to prove it.
 */

export const colors = {
  /** Screen background. */
  ground: '#0B1714',
  /** Rows, panels, anything sitting on the ground. */
  surface: '#13251F',
  /** Raised or pressed state of a surface. */
  surfaceHigh: '#1A3229',
  /** Input fields and wells, which sit *below* the surface. */
  well: '#07110E',

  line: '#22423A',
  lineStrong: '#2F594C',

  /** Warm off-white, picked to sit next to the bone of a tile face. */
  ink: '#F1EFE7',
  inkMuted: '#9CB3AA',
  inkFaint: '#6A8179',

  /** The single accent. */
  brass: '#E3B63E',
  brassDim: '#B28F24',
  brassWash: 'rgba(227, 182, 62, 0.14)',
  onBrass: '#120E05',

  /** Score movement. Muted on purpose - these appear in lists, in quantity. */
  gain: '#5FCB8B',
  loss: '#E28D66',

  /** Destructive actions only. */
  danger: '#E0685A',

  /** Tile face, for placeholders and the capture overlay. */
  bone: '#F6F2E9',
  overlay: 'rgba(9, 12, 11, 0.72)',

  /**
   * The table itself.
   *
   * The one place the interface is allowed to look like the object it is
   * about. Everywhere else stays on the neutral ramp; a mahjong table is
   * green baize inside a wooden rim, and a screen standing in for one reads
   * as a panel until it is. The green is desaturated well below a real baize
   * so it sits in a dark room rather than glowing out of it.
   */
  felt: '#17492F',
  feltHigh: '#1D5738',
  feltLine: '#2C6E4B',
  /** Warm rim around the baize, the wood of the table edge. */
  rim: '#5A462A',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * A tight type scale. Six sizes cover the whole app; a seventh would be a
 * decision nobody made on purpose.
 */
export const type = {
  display: { fontSize: 34, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 23, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: -0.1 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600', letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0 },
  /** Section labels. Uppercase with open tracking, used sparingly. */
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8 },
} as const;

/** Numerals that do not reflow as a score counts up. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

export const hairline = 1;

/**
 * Tiles are 3:4. Every place a tile is drawn derives its box from one of
 * these widths so that a tile is the same shape everywhere in the app.
 */
export const tileSize = {
  /** Inline in a list row. */
  sm: 26,
  /** The hand display and the review grid. */
  md: 40,
  /** The tile picker. */
  lg: 52,
} as const;

export const TILE_ASPECT = 4 / 3;

export function tileHeight(width: number): number {
  return Math.round(width * TILE_ASPECT);
}
