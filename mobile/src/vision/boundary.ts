/**
 * Working out which detections are *the hand*.
 *
 * A photograph of a hand usually contains other tiles: the wall behind it, a
 * neighbour's discards, tiles left on the table from the previous round. The
 * detector finds all of them, correctly, and the app then scores a hand the
 * player never had. Asking the user to frame more carefully does not work -
 * they are photographing a live table, and the other tiles are genuinely there.
 *
 * The tiles that make up one hand are close together and everything else is
 * further away, so this is a clustering problem rather than a detection one.
 * Link every pair of detections whose centres sit within a few tile widths,
 * take the largest connected group, and that is the hand. No new model, and it
 * runs on boxes we already have.
 *
 * The result is a proposal. The user sees it as one box on the photograph and
 * drags it when the guess is wrong, which is a far smaller correction than
 * fixing the tile list afterwards.
 */

import type { Detection } from './ordering';

export type Box = readonly [number, number, number, number];

/**
 * How far apart two tiles can sit and still count as the same hand, in
 * multiples of a tile's width.
 *
 * Touching tiles are about one width apart centre to centre. An exposed meld is
 * set aside by roughly half a tile, and a second row sits under the first, so
 * anything up to about two widths is still one hand. Three gives margin for a
 * loosely laid row without reaching across a table to the wall opposite, which
 * in a framed photograph is much further away than that.
 */
const LINK_DISTANCE_IN_TILE_WIDTHS = 3;

/** Grow the hand box by this fraction of a tile so edge tiles are not clipped. */
const PADDING_IN_TILE_WIDTHS = 0.35;

function centre(box: Box): { x: number; y: number } {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Indices of the largest group of mutually close detections.
 *
 * Union-find over the pairwise distances. Hands are tens of tiles, not
 * thousands, so the quadratic pass costs nothing and avoids a spatial index
 * that would have to be right.
 */
export function largestCluster(detections: readonly Detection[]): number[] {
  if (detections.length === 0) return [];
  if (detections.length === 1) return [0];

  const widths = detections.map((d) => d.box[2] - d.box[0]);
  const tileWidth = median(widths) || 1;
  const limit = tileWidth * LINK_DISTANCE_IN_TILE_WIDTHS;
  const limitSquared = limit * limit;

  const parent = detections.map((_, index) => index);
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== root) {
      const next = parent[a];
      parent[a] = root;
      a = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const centres = detections.map((d) => centre(d.box));
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = i + 1; j < centres.length; j += 1) {
      const dx = centres[i].x - centres[j].x;
      const dy = centres[i].y - centres[j].y;
      if (dx * dx + dy * dy <= limitSquared) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < detections.length; i += 1) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }

  let best: number[] = [];
  for (const group of groups.values()) {
    // Ties go to the group holding more tiles; on a genuine tie, the one that
    // starts earlier, so the result does not depend on Map iteration order.
    if (group.length > best.length || (group.length === best.length && group[0] < best[0])) {
      best = group;
    }
  }
  return best;
}

/**
 * A box around the hand, in the same pixel space as the detections, or null
 * when there is nothing to bound.
 *
 * `imageWidth`/`imageHeight` clamp the padding so the box never leaves the
 * photograph, which matters because it is used as a crop rectangle.
 */
export function handBoundary(
  detections: readonly Detection[],
  imageWidth: number,
  imageHeight: number,
): Box | null {
  const cluster = largestCluster(detections);
  if (cluster.length === 0) return null;

  const widths = cluster.map((i) => detections[i].box[2] - detections[i].box[0]);
  const pad = (median(widths) || 0) * PADDING_IN_TILE_WIDTHS;

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const index of cluster) {
    const box = detections[index].box;
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }

  return [
    Math.max(0, x0 - pad),
    Math.max(0, y0 - pad),
    Math.min(imageWidth, x1 + pad),
    Math.min(imageHeight, y1 + pad),
  ];
}

/** Whether a detection's centre falls inside the boundary. */
export function insideBoundary(box: Box, boundary: Box): boolean {
  const { x, y } = centre(box);
  return x >= boundary[0] && x <= boundary[2] && y >= boundary[1] && y <= boundary[3];
}

/** Keep only the detections whose centres fall inside the boundary. */
export function withinBoundary<T extends { box: Box }>(
  detections: readonly T[],
  boundary: Box | null,
): T[] {
  if (!boundary) return [...detections];
  return detections.filter((d) => insideBoundary(d.box, boundary));
}

/** Clamp a box to the image, keeping it non-degenerate. */
export function clampBox(box: Box, imageWidth: number, imageHeight: number): Box {
  const x0 = Math.max(0, Math.min(box[0], imageWidth - 1));
  const y0 = Math.max(0, Math.min(box[1], imageHeight - 1));
  const x1 = Math.max(x0 + 1, Math.min(box[2], imageWidth));
  const y1 = Math.max(y0 + 1, Math.min(box[3], imageHeight));
  return [x0, y0, x1, y1];
}
