import {
  cropToTensor,
  IMAGENET_STD,
  letterboxToTensor,
  softmax,
  topK,
  unletterbox,
} from '../image';
import parity from './parity.json';

/**
 * Preprocessing parity with the training pipeline.
 *
 * The reference tensors in parity.json come from the Python code that fed the
 * model during training (ml/src/make_parity_fixtures.py). If these ever drift
 * apart the app hands the model differently-framed pixels than it learned on,
 * and the symptom - a model that scores well offline and badly in the hand -
 * is very hard to diagnose from either side. Regenerate the fixtures whenever
 * either implementation changes.
 */

interface ParityCase {
  name: string;
  kind: 'letterbox' | 'crop';
  width: number;
  height: number;
  rgba: number[];
  tensor: number[];
  size?: number;
  scale?: number;
  padX?: number;
  padY?: number;
  box?: number[];
  outWidth?: number;
  outHeight?: number;
}

const cases = (parity as { cases: ParityCase[] }).cases;

/**
 * One 8-bit step, expressed in normalised units through the channel with the
 * smallest standard deviation - the one where a single byte moves the
 * normalised value furthest. A disagreement at or below this is two
 * implementations rounding a tie differently; anything above it is a real
 * difference in what they compute.
 */
const ONE_BYTE_STEP = 1 / 255 / Math.min(...IMAGENET_STD);
const EPSILON = 1e-6;

function imageOf(testCase: ParityCase) {
  return {
    data: Uint8Array.from(testCase.rgba),
    width: testCase.width,
    height: testCase.height,
  };
}

/** Worst absolute disagreement between two tensors. */
function maxDelta(a: Float32Array, b: number[]): number {
  let worst = 0;
  for (let i = 0; i < b.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('preprocessing parity with the training pipeline', () => {
  const letterboxCases = cases.filter((c) => c.kind === 'letterbox');
  const cropCases = cases.filter((c) => c.kind === 'crop');

  it('has fixtures to check against', () => {
    expect(letterboxCases.length).toBeGreaterThan(0);
    expect(cropCases.length).toBeGreaterThan(0);
  });

  it.each(letterboxCases.map((c) => [c.name, c] as const))(
    'letterboxes %s identically to Python',
    (_name, testCase) => {
      const { tensor, info } = letterboxToTensor(imageOf(testCase), testCase.size!);
      expect(info.scale).toBeCloseTo(testCase.scale!, 6);
      expect(info.padX).toBe(testCase.padX);
      expect(info.padY).toBe(testCase.padY);
      expect(tensor).toHaveLength(testCase.tensor.length);
      expect(maxDelta(tensor, testCase.tensor)).toBeLessThan(1e-4);
    },
  );

  it.each(cropCases.map((c) => [c.name, c] as const))(
    'crops %s to within one byte of Python',
    (_name, testCase) => {
      const tensor = cropToTensor(
        imageOf(testCase),
        testCase.box as [number, number, number, number],
        testCase.outWidth!,
        testCase.outHeight!,
      );
      expect(tensor).toHaveLength(testCase.tensor.length);
      // Both sides quantise to a byte before normalising, so the residual is
      // OpenCV's fixed-point bilinear rounding a tie the other way - at most
      // one least-significant step, on a handful of pixels.
      expect(maxDelta(tensor, testCase.tensor)).toBeLessThanOrEqual(ONE_BYTE_STEP + EPSILON);
    },
  );
});

describe('letterbox geometry', () => {
  const image = { data: new Uint8Array(40 * 30 * 4).fill(200), width: 40, height: 30 };

  it('centres a landscape image and pads above and below', () => {
    const { info } = letterboxToTensor(image, 60);
    expect(info.scale).toBeCloseTo(1.5, 6);
    expect(info.padX).toBe(0);
    expect(info.padY).toBe(7);
  });

  it('round-trips a box back to source coordinates', () => {
    const { info } = letterboxToTensor(image, 60);
    const source: [number, number, number, number] = [4, 6, 20, 24];
    const inModelSpace: [number, number, number, number] = [
      source[0] * info.scale + info.padX,
      source[1] * info.scale + info.padY,
      source[2] * info.scale + info.padX,
      source[3] * info.scale + info.padY,
    ];
    const back = unletterbox(inModelSpace, info, image.width, image.height);
    back.forEach((value, index) => expect(value).toBeCloseTo(source[index], 4));
  });

  it('clamps boxes that fall outside the frame', () => {
    const { info } = letterboxToTensor(image, 60);
    const back = unletterbox([-50, -50, 500, 500], info, image.width, image.height);
    expect(back).toEqual([0, 0, 40, 30]);
  });
});

describe('softmax and ranking', () => {
  it('produces a distribution that sums to one', () => {
    const probabilities = softmax([2, 1, 0.1, -3]);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(probabilities[0]).toBeGreaterThan(probabilities[1]);
  });

  it('survives large logits without overflowing', () => {
    const probabilities = softmax([1000, 999, 998]);
    expect(probabilities.every((p) => Number.isFinite(p))).toBe(true);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('ranks the top k by value', () => {
    expect(topK([0.1, 0.7, 0.05, 0.15], 2)).toEqual([
      { index: 1, value: 0.7 },
      { index: 3, value: 0.15 },
    ]);
  });
});
