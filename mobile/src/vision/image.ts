/**
 * Pixel work, kept pure.
 *
 * Everything here operates on a plain RGBA byte array, which means it can be
 * unit tested on a machine with no camera, no GPU and no device attached -
 * and it is where the bugs would otherwise hide. Letterboxing that is off by
 * one, or a crop that reads the wrong rectangle, looks exactly like a model
 * that does not work.
 */

export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export interface LetterboxInfo {
  readonly scale: number;
  readonly padX: number;
  readonly padY: number;
  readonly size: number;
}

/**
 * Resize into a square, preserving aspect ratio, padding the remainder grey.
 *
 * Mirrors `letterbox` in ml/src/data.py exactly. If the two ever diverge the
 * model sees a differently-framed image at inference than it saw in training,
 * and the accuracy drop looks inexplicable from either side.
 */
/**
 * Exact-area resample of one channel: the average of the source pixels each
 * destination pixel covers, weighted by how much of each it covers.
 *
 * This is what OpenCV's INTER_AREA does when downscaling, and reproducing it
 * exactly is the whole point - the alternative is an app that frames pixels a
 * little differently than training did, which shows up as unexplained accuracy
 * loss rather than as a bug.
 */
function areaAverage(
  sample: (x: number, y: number, channel: number) => number,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  dx: number,
  dy: number,
  channel: number,
): number {
  const scaleX = sourceWidth / destWidth;
  const scaleY = sourceHeight / destHeight;
  const xStart = dx * scaleX;
  const xEnd = xStart + scaleX;
  const yStart = dy * scaleY;
  const yEnd = yStart + scaleY;

  let total = 0;
  let weight = 0;
  for (let sy = Math.floor(yStart); sy < Math.ceil(yEnd); sy += 1) {
    const wy = Math.min(yEnd, sy + 1) - Math.max(yStart, sy);
    if (wy <= 0) continue;
    for (let sx = Math.floor(xStart); sx < Math.ceil(xEnd); sx += 1) {
      const wx = Math.min(xEnd, sx + 1) - Math.max(xStart, sx);
      if (wx <= 0) continue;
      total += wx * wy * sample(sx, sy, channel);
      weight += wx * wy;
    }
  }
  return weight > 0 ? total / weight : sample(Math.floor(xStart), Math.floor(yStart), channel);
}

/**
 * Round a resampled value back to a byte before it is normalised.
 *
 * OpenCV writes its resize result into an 8-bit image, so every pixel the
 * model saw during training had been quantised. Keeping full float precision
 * here would be *more* accurate and therefore less faithful - the half-step
 * offset it introduces is small, but it is a systematic one applied to every
 * pixel of every inference, which is the kind of skew worth eliminating rather
 * than tolerating.
 */
function quantise(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Bilinear with OpenCV's half-pixel centre convention. */
function bilinear(
  sample: (x: number, y: number, channel: number) => number,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  dx: number,
  dy: number,
  channel: number,
): number {
  const sourceX = ((dx + 0.5) * sourceWidth) / destWidth - 0.5;
  const sourceY = ((dy + 0.5) * sourceHeight) / destHeight - 0.5;
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const wx = sourceX - x0;
  const wy = sourceY - y0;

  return (
    sample(x0, y0, channel) * (1 - wx) * (1 - wy) +
    sample(x0 + 1, y0, channel) * wx * (1 - wy) +
    sample(x0, y0 + 1, channel) * (1 - wx) * wy +
    sample(x0 + 1, y0 + 1, channel) * wx * wy
  );
}

/**
 * Resize into a square, preserving aspect ratio, padding the remainder grey.
 *
 * Mirrors `letterbox` in ml/src/data.py, down to the interpolation. If the two
 * ever diverge the model sees a differently-framed image at inference than it
 * saw in training; src/vision/__tests__/image.test.ts pins them together.
 */
export function letterboxToTensor(
  image: RgbaImage,
  size: number,
  padValue = 114,
): { tensor: Float32Array; info: LetterboxInfo } {
  const scale = Math.min(size / image.width, size / image.height);
  const newWidth = Math.round(image.width * scale);
  const newHeight = Math.round(image.height * scale);
  const padX = Math.floor((size - newWidth) / 2);
  const padY = Math.floor((size - newHeight) / 2);

  // NCHW, planar: the whole red plane, then green, then blue.
  const tensor = new Float32Array(3 * size * size);
  const plane = size * size;

  const paddedValue = [
    (padValue / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0],
    (padValue / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1],
    (padValue / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2],
  ];
  for (let c = 0; c < 3; c += 1) tensor.fill(paddedValue[c], c * plane, (c + 1) * plane);

  const sample = (x: number, y: number, channel: number) => sampleClamped(image, x, y, channel);
  const upscaling = newWidth > image.width || newHeight > image.height;
  const resample = upscaling ? bilinear : areaAverage;

  for (let y = 0; y < newHeight; y += 1) {
    const destRow = (y + padY) * size;
    for (let x = 0; x < newWidth; x += 1) {
      const dest = destRow + x + padX;
      for (let c = 0; c < 3; c += 1) {
        const value = quantise(
          resample(sample, image.width, image.height, newWidth, newHeight, x, y, c),
        );
        tensor[c * plane + dest] = (value / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
      }
    }
  }

  return { tensor, info: { scale, padX, padY, size } };
}

/** Map a box from letterboxed model space back onto the source image. */
export function unletterbox(
  box: readonly [number, number, number, number],
  info: LetterboxInfo,
  imageWidth: number,
  imageHeight: number,
): [number, number, number, number] {
  const x0 = (box[0] - info.padX) / info.scale;
  const y0 = (box[1] - info.padY) / info.scale;
  const x1 = (box[2] - info.padX) / info.scale;
  const y1 = (box[3] - info.padY) / info.scale;
  return [
    Math.max(0, Math.min(imageWidth, x0)),
    Math.max(0, Math.min(imageHeight, y0)),
    Math.max(0, Math.min(imageWidth, x1)),
    Math.max(0, Math.min(imageHeight, y1)),
  ];
}

/**
 * Cut one tile out and resize it to the classifier's input.
 *
 * Bilinear rather than nearest: a tile crop is being shrunk by a factor of two
 * or three, and nearest-neighbour aliasing on the fine engraving of a
 * character tile is exactly the detail the classifier depends on.
 *
 * `pad` matches the training-time crop padding in ml/src/data.py.
 */
export function cropToTensor(
  image: RgbaImage,
  box: readonly [number, number, number, number],
  outWidth: number,
  outHeight: number,
  pad = 0.14,
  target?: Float32Array,
  offset = 0,
): Float32Array {
  const centreX = (box[0] + box[2]) / 2;
  const centreY = (box[1] + box[3]) / 2;
  const boxWidth = (box[2] - box[0]) * (1 + 2 * pad);
  const boxHeight = (box[3] - box[1]) * (1 + 2 * pad);

  // Integer bounds, as extract_crop takes them, so the two implementations
  // read the same rectangle. Edges are replicated rather than clipped, which
  // keeps a tile at the frame edge the right shape instead of squashing it.
  const x0 = Math.round(centreX - boxWidth / 2);
  const y0 = Math.round(centreY - boxHeight / 2);
  const x1 = Math.round(centreX + boxWidth / 2);
  const y1 = Math.round(centreY + boxHeight / 2);
  const regionWidth = Math.max(1, x1 - x0);
  const regionHeight = Math.max(1, y1 - y0);

  const sample = (x: number, y: number, channel: number) =>
    sampleClamped(image, x0 + x, y0 + y, channel);

  const tensor = target ?? new Float32Array(3 * outWidth * outHeight);
  const plane = outWidth * outHeight;
  const upscaling = regionWidth < outWidth || regionHeight < outHeight;
  const resample = upscaling ? bilinear : areaAverage;

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const value = quantise(
          resample(sample, regionWidth, regionHeight, outWidth, outHeight, x, y, c),
        );
        tensor[offset + c * plane + y * outWidth + x] =
          (value / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
      }
    }
  }

  return tensor;
}

/** Edge-clamped sample, so crops that overhang the frame still read sensibly. */
function sampleClamped(image: RgbaImage, x: number, y: number, channel: number): number {
  const cx = Math.max(0, Math.min(image.width - 1, x));
  const cy = Math.max(0, Math.min(image.height - 1, y));
  return image.data[(cy * image.width + cx) * 4 + channel];
}

/** Numerically stable softmax over one row of logits. */
export function softmax(logits: Float32Array | number[], offset = 0, length?: number): number[] {
  const size = length ?? logits.length;
  let max = -Infinity;
  for (let i = 0; i < size; i += 1) max = Math.max(max, logits[offset + i]);

  let sum = 0;
  const out = new Array<number>(size);
  for (let i = 0; i < size; i += 1) {
    const value = Math.exp(logits[offset + i] - max);
    out[i] = value;
    sum += value;
  }
  for (let i = 0; i < size; i += 1) out[i] /= sum;
  return out;
}

export function topK(probabilities: number[], k: number): { index: number; value: number }[] {
  return probabilities
    .map((value, index) => ({ index, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, k);
}
