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
 * The greens in the neutral ramp are barely there - a few points of hue in
 * near-black - but they keep the bone white of the tiles reading as warm.
 */

export const colors = {
  /** Screen background. */
  ground: '#0F1412',
  /** Rows, panels, anything sitting on the ground. */
  surface: '#161D1A',
  /** Raised or pressed state of a surface. */
  surfaceHigh: '#1E2723',
  /** Input fields and wells, which sit *below* the surface. */
  well: '#0B0F0E',

  line: '#28312D',
  lineStrong: '#38433E',

  /** Warm off-white, picked to sit next to the bone of a tile face. */
  ink: '#ECEAE4',
  inkMuted: '#97A09A',
  inkFaint: '#646E68',

  /** The single accent. */
  brass: '#C9A227',
  brassDim: '#9A7C1D',
  brassWash: 'rgba(201, 162, 39, 0.12)',
  onBrass: '#120E05',

  /** Score movement. Muted on purpose - these appear in lists, in quantity. */
  gain: '#7FB68E',
  loss: '#CE8168',

  /** Destructive actions only. */
  danger: '#C4695A',

  /** Tile face, for placeholders and the capture overlay. */
  bone: '#F1EDE4',
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
  felt: '#123227',
  feltHigh: '#17402F',
  feltLine: '#1D4C39',
  /** Warm rim around the baize, the wood of the table edge. */
  rim: '#4A3A24',
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
