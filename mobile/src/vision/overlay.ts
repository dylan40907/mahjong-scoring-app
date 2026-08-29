/**
 * Placing detection boxes on top of the displayed photograph.
 *
 * The preview renders with `resizeMode="contain"`, which letterboxes the image
 * inside its container. Boxes come back in decoded-image pixels, so drawing
 * them means reproducing that same fit exactly - any disagreement puts every
 * box in the wrong place at once.
 *
 * This lives apart from the screen because it is pure arithmetic over two
 * rectangles, and because getting it wrong is invisible in a type check and
 * obvious only on a photograph whose subject does not reach the edges. That is
 * the case it got wrong in practice: the fit was computed from the extent of
 * the detections rather than the size of the image, which is the same thing
 * only when the tiles happen to touch all four edges.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ContainFit {
  /** Multiply image pixels by this to get container pixels. */
  readonly scale: number;
  /** Letterbox padding, in container pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The transform `resizeMode="contain"` applies when fitting `source` into
 * `container`, or null when either is not measured yet.
 */
export function containFit(source: Size | null, container: Size): ContainFit | null {
  if (!source || source.width <= 0 || source.height <= 0) return null;
  if (container.width <= 0 || container.height <= 0) return null;

  const scale = Math.min(container.width / source.width, container.height / source.height);
  return {
    scale,
    offsetX: (container.width - source.width * scale) / 2,
    offsetY: (container.height - source.height * scale) / 2,
  };
}

/** One box, in decoded-image pixels, placed in container pixels. */
export function placeBox(
  box: readonly [number, number, number, number],
  fit: ContainFit,
): { left: number; top: number; width: number; height: number } {
  return {
    left: box[0] * fit.scale + fit.offsetX,
    top: box[1] * fit.scale + fit.offsetY,
    width: (box[2] - box[0]) * fit.scale,
    height: (box[3] - box[1]) * fit.scale,
  };
}
