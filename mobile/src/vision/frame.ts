/**
 * The capture frame, and the promise it makes.
 *
 * The frame on the capture screen is not decoration and it is not a guide. It
 * is a contract: what is inside it is the hand, what is outside it does not
 * exist. The app used to show a wide frame, photograph the whole sensor, and
 * then hunt for the hand inside the result - so the review screen came back
 * with a tall picture full of things the user had deliberately kept out of
 * shot, and the boundary they thought they had drawn with the camera turned
 * out to be a suggestion.
 *
 * Cropping the photograph to the frame at the moment it is taken makes the
 * viewfinder honest. It also removes the whole class of "why did it read a
 * tile that was not in the picture" problems at the cheapest possible point,
 * and it means every later stage - detection, the saved photograph, the
 * boundary box - is working on the same rectangle the user framed.
 */

/**
 * Width over height of the frame.
 *
 * A hand is laid out in one or two rows: two rows of eight 3:4 tiles is about
 * 3:1, so a frame near that shape is filled by the hand rather than by the
 * table around it. Anything squarer spends most of the sensor - and most of
 * the detector's 320-pixel input - on wood.
 */
export const CAPTURE_ASPECT = 2.35;

export interface CropRect {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The slice of an image the frame was showing, or null when it already fits.
 *
 * Kept separate from the crop itself so the arithmetic can be tested without
 * an image: getting this wrong shifts every detection box by half the
 * difference, which is the kind of error that looks like a bad model.
 */
export function frameCrop(width: number, height: number, aspect: number): CropRect | null {
  if (!(width > 0) || !(height > 0) || !(aspect > 0)) return null;

  // `cover`: the axis that already fits is kept whole, the other is a centred
  // slice. An image narrower than the frame loses height; a wider one loses
  // width.
  const narrower = width / height < aspect;
  const cropWidth = narrower ? width : Math.round(height * aspect);
  const cropHeight = narrower ? Math.round(width / aspect) : height;
  if (cropWidth >= width && cropHeight >= height) return null;

  return {
    originX: Math.max(0, Math.round((width - cropWidth) / 2)),
    originY: Math.max(0, Math.round((height - cropHeight) / 2)),
    width: Math.min(width, cropWidth),
    height: Math.min(height, cropHeight),
  };
}
