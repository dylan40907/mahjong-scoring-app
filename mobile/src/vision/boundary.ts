/**
 * The area of a photograph the hand occupies.
 *
 * This used to be inferred: cluster the detections, take the largest connected
 * group, call that the hand. It worked often enough to be trusted and failed
 * in the way guesses do - silently, and on the photographs that mattered. A
 * hand laid out in two rows read as two clusters and lost half of itself; a
 * neatly stacked wall behind the hand outnumbered it and won.
 *
 * The camera frame is a better boundary than any clustering, because the user
 * drew it deliberately. The capture screen crops the photograph to the frame,
 * so the boundary starts as the whole picture and the only question left is
 * whether the user wants to shrink it - which happens when something strayed
 * into shot, and is one drag away.
 *
 * What remains here is the arithmetic that boundary needs once it exists:
 * keeping it inside the image, and deciding what falls within it.
 */

export type Box = readonly [number, number, number, number];

function centre(box: Box): { x: number; y: number } {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

/**
 * The default boundary: everything the photograph holds.
 *
 * Null for an image whose size is not known yet, which the review screen
 * treats as "no box to draw" rather than as an empty one.
 */
export function fullFrame(imageWidth: number, imageHeight: number): Box | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  return [0, 0, imageWidth, imageHeight];
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
