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
 *
 * It is also a *lit* jade rather than a jade-tinted black. The first attempt
 * measured well and looked right in a screenshot on a bright monitor, then
 * arrived on an actual phone as four shades of almost-black: the hue was
 * there, but there was not enough light in it to see the hue, and not enough
 * distance between the steps to see the structure. Every step here is lifted
 * and given more chroma, and the gap between ground and surface is roughly
 * doubled, so a panel reads as a raised thing at half brightness in daylight
 * rather than only in a dark room.
 */

export const colors = {
  /** Screen background. */
  ground: '#123A2E',
  /** Rows, panels, anything sitting on the ground. */
  surface: '#1B4D3B',
  /** Raised or pressed state of a surface. */
  surfaceHigh: '#26624B',
  /** Input fields and wells, which sit *below* the surface. */
  well: '#0C2C22',

  line: '#357355',
  lineStrong: '#4A9A73',

  /** Warm off-white, picked to sit next to the bone of a tile face. */
  ink: '#F4F2E8',
  inkMuted: '#B6D4C1',
  inkFaint: '#8AB29B',

  /** The single accent. */
  brass: '#F5C63C',
  brassDim: '#C79E27',
  brassWash: 'rgba(245, 198, 60, 0.16)',
  onBrass: '#16120A',

  /** Score movement. Bright enough to read at caption size in a list. */
  gain: '#5FE39B',
  loss: '#FF9E6E',

  /** Destructive actions only. */
  danger: '#FF7A67',

  /** Tile face, for placeholders and the capture overlay. */
  bone: '#F8F4EB',
  overlay: 'rgba(8, 26, 20, 0.76)',

  /**
   * The table itself.
   *
   * The one place the interface is allowed to look like the object it is
   * about. Everywhere else stays on the neutral ramp; a mahjong table is
   * green baize inside a wooden rim, and a screen standing in for one reads
   * as a panel until it is.
   *
   * Now that the whole app is jade, the baize has to be *brighter* than its
   * surroundings rather than merely greener, or the table stops being an
   * object on a screen and becomes a slightly different patch of screen.
   */
  felt: '#22824F',
  feltHigh: '#2C9B60',
  feltLine: '#45BC81',
  /** Warm rim around the baize, the wood of the table edge. */
  rim: '#8A6C39',
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
 * Elevation, as a shadow rather than as a lighter fill.
 *
 * Used on the two things that are genuinely lifted off the page - the primary
 * action and the table - and nowhere else. A dark interface that shadows
 * everything ends up looking like it is made of floating cards; one that
 * shadows nothing at all reads as flat paint, which is what this did.
 */
export const shadow = {
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sunken: {
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

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
