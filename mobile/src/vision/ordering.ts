import type { TileCode } from '@/tiles/tileset';

/**
 * Turning scattered boxes into a hand.
 *
 * A detector returns boxes in confidence order, which is meaningless to a
 * scoring engine. What the engine needs is the hand as a player reads it:
 * left to right, top row before bottom, with melds kept separate from the
 * concealed tiles. Recovering that from geometry is the "spatially order"
 * half of the pipeline, and it is where a naive implementation quietly fails.
 *
 * Sorting by the y coordinate and then by x is the obvious approach and it
 * breaks the moment the phone is not held square to the table. A row of
 * sixteen tiles tilted ten degrees spans more vertical distance end to end
 * than a tile is tall, so the first and last tiles of one row land in
 * different y-clusters and the hand comes out interleaved.
 *
 * So the row direction is measured rather than assumed: the vector from each
 * tile to its nearest neighbour points along the row, and the median of those
 * vectors gives the table's orientation. Everything is then rotated flat and
 * ordering becomes trivial again.
 */

export interface Detection {
  /** [x0, y0, x1, y1] in source-image pixels. */
  readonly box: readonly [number, number, number, number];
  readonly code: TileCode;
  readonly confidence: number;
  /** The classifier's next-best guesses, for the correction shortlist. */
  readonly alternatives?: readonly { code: TileCode; confidence: number }[];
}

export interface OrderedTile extends Detection {
  readonly row: number;
  readonly group: number;
  readonly indexInGroup: number;
}

export interface OrderedHand {
  /** Groups in reading order; each group is a run of touching tiles. */
  readonly groups: OrderedTile[][];
  readonly tiles: OrderedTile[];
  /** Measured table rotation, in degrees. Reported for the review overlay. */
  readonly rotationDegrees: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function centre(box: Detection['box']): Point {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The dominant row direction, in radians.
 *
 * Each tile contributes the vector to its nearest neighbour. Within a row
 * that vector is horizontal, so the angles pile up around the row direction;
 * the few tiles whose nearest neighbour is in the row above or below
 * contribute outliers, which the median discards. Angles are folded into
 * (-90, 90] degrees first so that a neighbour to the left and one to the right
 * agree rather than cancelling.
 */
export function estimateRotation(detections: readonly Detection[]): number {
  if (detections.length < 3) return 0;
  const centres = detections.map((d) => centre(d.box));
  const angles: number[] = [];

  for (let i = 0; i < centres.length; i += 1) {
    let bestDistance = Infinity;
    let best: Point | null = null;
    for (let j = 0; j < centres.length; j += 1) {
      if (i === j) continue;
      const dx = centres[j].x - centres[i].x;
      const dy = centres[j].y - centres[i].y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = centres[j];
      }
    }
    if (!best) continue;

    let dx = best.x - centres[i].x;
    let dy = best.y - centres[i].y;
    // Fold direction so left and right neighbours vote the same way.
    if (dx < 0) {
      dx = -dx;
      dy = -dy;
    }
    angles.push(Math.atan2(dy, dx));
  }

  const angle = median(angles);
  // A row is horizontal by construction; anything past 40 degrees is a
  // misread rather than a genuinely diagonal hand, so it is ignored.
  return Math.abs(angle) > (40 * Math.PI) / 180 ? 0 : angle;
}

function rotate(point: Point, radians: number): Point {
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * Order detections into rows and groups.
 *
 * `groupGapRatio` is the gap, as a fraction of tile width, that separates one
 * group from the next. Tiles in a meld touch; a meld is set apart from the
 * concealed hand by a visible space. Half a tile width sits comfortably
 * between "touching" and "deliberately separated".
 */
export function orderDetections(
  detections: readonly Detection[],
  options: { rowToleranceRatio?: number; groupGapRatio?: number } = {},
): OrderedHand {
  const rowTolerance = options.rowToleranceRatio ?? 0.6;
  const groupGap = options.groupGapRatio ?? 0.5;

  if (detections.length === 0) {
    return { groups: [], tiles: [], rotationDegrees: 0 };
  }

  const rotation = estimateRotation(detections);
  const widths = detections.map((d) => d.box[2] - d.box[0]);
  const heights = detections.map((d) => d.box[3] - d.box[1]);
  const tileWidth = median(widths) || 1;
  const tileHeight = median(heights) || 1;

  const placed = detections.map((detection) => ({
    detection,
    point: rotate(centre(detection.box), rotation),
  }));

  // Rows: sweep down the rotated frame, starting a new row whenever a tile
  // sits more than a fraction of a tile height below the current row's mean.
  placed.sort((a, b) => a.point.y - b.point.y);
  const rows: (typeof placed)[] = [];
  let current: typeof placed = [];
  let rowMean = placed[0].point.y;

  for (const item of placed) {
    if (current.length > 0 && Math.abs(item.point.y - rowMean) > tileHeight * rowTolerance) {
      rows.push(current);
      current = [];
      rowMean = item.point.y;
    }
    current.push(item);
    rowMean = current.reduce((sum, entry) => sum + entry.point.y, 0) / current.length;
  }
  if (current.length > 0) rows.push(current);

  const groups: OrderedTile[][] = [];
  const tiles: OrderedTile[] = [];

  rows.forEach((row, rowIndex) => {
    row.sort((a, b) => a.point.x - b.point.x);
    let group: OrderedTile[] = [];

    row.forEach((item, positionInRow) => {
      if (positionInRow > 0) {
        const previous = row[positionInRow - 1];
        const gap = item.point.x - previous.point.x - tileWidth;
        if (gap > tileWidth * groupGap) {
          groups.push(group);
          group = [];
        }
      }
      const ordered: OrderedTile = {
        ...item.detection,
        row: rowIndex,
        group: groups.length,
        indexInGroup: group.length,
      };
      group.push(ordered);
      tiles.push(ordered);
    });

    if (group.length > 0) groups.push(group);
  });

  return { groups, tiles, rotationDegrees: (rotation * 180) / Math.PI };
}

/**
 * Split an ordered hand into the concealed tiles and the exposed melds.
 *
 * A group of exactly three or four tiles that is separated from the rest is
 * almost always a declared meld; the largest group is the concealed hand.
 * This is a heuristic and the review screen lets the user override it, which
 * is the right division of labour - geometry proposes, the player confirms.
 */
export function splitHandAndMelds(hand: OrderedHand): {
  concealed: OrderedTile[];
  melds: OrderedTile[][];
} {
  if (hand.groups.length <= 1) {
    return { concealed: hand.groups[0] ?? [], melds: [] };
  }

  let largestIndex = 0;
  hand.groups.forEach((group, index) => {
    if (group.length > hand.groups[largestIndex].length) largestIndex = index;
  });

  const melds: OrderedTile[][] = [];
  hand.groups.forEach((group, index) => {
    if (index === largestIndex) return;
    if (group.length === 3 || group.length === 4) melds.push(group);
  });

  const meldTiles = new Set(melds.flat());
  const concealed = hand.groups
    .filter((_, index) => index === largestIndex)
    .flat()
    .concat(hand.groups.filter((_, i) => i !== largestIndex).flat().filter((t) => !meldTiles.has(t)));

  return { concealed, melds };
}
