import { NativeModules, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode as decodeJpeg } from 'jpeg-js';
import type { InferenceSession as OrtSession, Tensor as OrtTensor } from 'onnxruntime-react-native';
import { CODES, type TileCode } from '@/tiles/tileset';
import type { Detection } from './ordering';
import {
  cropToTensor,
  letterboxToTensor,
  softmax,
  topK,
  unletterbox,
  type RgbaImage,
} from './image';

/**
 * On-device inference: photograph in, labelled boxes out.
 *
 * Two models rather than one. The detector runs on a 320-pixel letterbox of
 * the whole photo and answers only "where are the tiles"; the classifier then
 * reads each tile from a crop taken at full resolution, where the engraved
 * character is a hundred pixels tall rather than a dozen. Both models together
 * are under two megabytes and both run on the CPU.
 *
 * Everything here fails soft. A missing model, an unsupported platform, a
 * photo that will not decode - each returns a result the review screen can
 * still work with, because manual tile entry always remains available. An app
 * that becomes unusable when the model fails is worse than one without a
 * model.
 */

const DETECTOR_INPUT = 320;
const CROP_WIDTH = 48;
const CROP_HEIGHT = 64;
const MAX_SOURCE_WIDTH = 1280;
const SCORE_THRESHOLD = 0.35;
const MAX_TILES = 40;

export type VisionAvailability = 'ready' | 'loading' | 'unsupported' | 'error';

export interface DetectionResult {
  readonly detections: Detection[];
  /** Dimensions of the decoded image the boxes refer to. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly durationMs: number;
}

export class VisionUnavailableError extends Error {
  constructor(
    message: string,
    readonly kind: Exclude<VisionAvailability, 'ready' | 'loading'>,
  ) {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

/**
 * Whether on-device inference can run here at all.
 *
 * Checked by looking for the native module directly rather than by importing
 * the package. `onnxruntime-react-native/binding` calls
 * `NativeModules.Onnxruntime.install()` at *import* time, so merely requiring
 * it where the native side is absent throws a TypeError rather than returning
 * something falsy. Probing `NativeModules` first is free and cannot throw.
 *
 * Two environments legitimately lack it:
 *
 *   - the web build, which exists to develop and review the interface;
 *   - Expo Go, which ships a fixed set of native modules and cannot include
 *     an arbitrary one. A development build can.
 *
 * Both fall through to manual tile entry, which is a first-class path rather
 * than an error state.
 */
export function isVisionSupported(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  return NativeModules.Onnxruntime != null;
}

/** Why inference is unavailable, phrased for the capture screen. */
export function visionUnavailableReason(): string | null {
  if (isVisionSupported()) return null;
  if (Platform.OS === 'web') {
    return 'Reading tiles from a photo needs the native app. Enter the hand by hand here.';
  }
  return 'Expo Go cannot load the tile models. Everything else works — enter the hand by hand, or make a development build to read tiles from photos.';
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

let sessions: { detector: OrtSession; classifier: OrtSession } | null = null;
let loading: Promise<{ detector: OrtSession; classifier: OrtSession }> | null = null;

async function loadSessions() {
  if (sessions) return sessions;
  if (!isVisionSupported()) {
    throw new VisionUnavailableError(
      visionUnavailableReason() ?? 'On-device inference is unavailable here.',
      'unsupported',
    );
  }

  if (!loading) {
    loading = (async () => {
      // Required lazily rather than imported: a static import of the native
      // module is evaluated when the bundle loads, which throws on web and
      // takes down the whole app rather than one screen. The asset requires
      // below must also stay as require() - Metro resolves those statically at
      // build time and cannot follow an import expression.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ort = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native');

      const [detectorAsset, classifierAsset] = await Asset.loadAsync([
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@/assets/models/detector.onnx'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@/assets/models/classifier.onnx'),
      ]);

      const options: OrtSession.SessionOptions = {
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
      };

      const detector = await ort.InferenceSession.create(
        detectorAsset.localUri ?? detectorAsset.uri,
        options,
      );
      const classifier = await ort.InferenceSession.create(
        classifierAsset.localUri ?? classifierAsset.uri,
        options,
      );

      sessions = { detector, classifier };
      return sessions;
    })().catch((error) => {
      loading = null;
      throw new VisionUnavailableError(
        `The tile models could not be loaded: ${String(error)}`,
        'error',
      );
    });
  }

  return loading;
}

/** Start loading in the background so the capture screen is not the first wait. */
export function warmUp(): void {
  if (!isVisionSupported()) return;
  void loadSessions().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Image decoding
// ---------------------------------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  // React Native ships a global atob; this avoids a Buffer polyfill.
  const binary = global.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode the photo once, at a size that keeps tile detail without paying for
 * a twelve-megapixel array.
 *
 * At 1280 pixels wide a sixteen-tile row still gives roughly eighty pixels per
 * tile, which is far more than the classifier's 48x64 input needs, while the
 * decode stays around a third of a second in pure JavaScript.
 */
async function decodeImage(uri: string): Promise<RgbaImage> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_SOURCE_WIDTH } }],
    { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );

  if (!result.base64) throw new Error('The photo could not be read.');
  const decoded = decodeJpeg(base64ToBytes(result.base64), { useTArray: true });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export async function detectTiles(
  uri: string,
  options: { scoreThreshold?: number } = {},
): Promise<DetectionResult> {
  const started = Date.now();
  const threshold = options.scoreThreshold ?? SCORE_THRESHOLD;
  const { detector, classifier } = await loadSessions();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ort = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native');

  const image = await decodeImage(uri);
  const { tensor, info } = letterboxToTensor(image, DETECTOR_INPUT);

  const detectorOutput = await detector.run({
    image: new ort.Tensor('float32', tensor, [1, 3, DETECTOR_INPUT, DETECTOR_INPUT]),
  });

  const boxesTensor = detectorOutput.boxes as OrtTensor;
  const scoresTensor = detectorOutput.scores as OrtTensor;
  const boxData = boxesTensor.data as Float32Array;
  const scoreData = scoresTensor.data as Float32Array;

  const kept: { box: [number, number, number, number]; score: number }[] = [];
  for (let i = 0; i < scoreData.length && kept.length < MAX_TILES; i += 1) {
    if (scoreData[i] < threshold) continue;
    const raw: [number, number, number, number] = [
      boxData[i * 4],
      boxData[i * 4 + 1],
      boxData[i * 4 + 2],
      boxData[i * 4 + 3],
    ];
    const box = unletterbox(raw, info, image.width, image.height);
    if (box[2] - box[0] < 4 || box[3] - box[1] < 6) continue;
    kept.push({ box, score: scoreData[i] });
  }

  if (kept.length === 0) {
    return { detections: [], imageWidth: image.width, imageHeight: image.height, durationMs: Date.now() - started };
  }

  // One batched classifier call rather than one per tile: the per-call
  // overhead across the bridge dominates the arithmetic at this model size.
  const cropSize = 3 * CROP_WIDTH * CROP_HEIGHT;
  const batch = new Float32Array(kept.length * cropSize);
  kept.forEach((entry, index) => {
    cropToTensor(image, entry.box, CROP_WIDTH, CROP_HEIGHT, 0.14, batch, index * cropSize);
  });

  const classifierOutput = await classifier.run({
    crops: new ort.Tensor('float32', batch, [kept.length, 3, CROP_HEIGHT, CROP_WIDTH]),
  });
  const logits = (classifierOutput.logits as OrtTensor).data as Float32Array;
  const classCount = logits.length / kept.length;

  const detections: Detection[] = kept.map((entry, index) => {
    const probabilities = softmax(logits, index * classCount, classCount);
    const ranked = topK(probabilities, 3);
    return {
      box: entry.box,
      code: CODES[ranked[0].index] as TileCode,
      // Confidence is the classifier's, tempered by the detector's: a
      // confidently-read tile in a doubtful box is not a confident detection.
      confidence: ranked[0].value * entry.score,
      alternatives: ranked.slice(1).map((alternative) => ({
        code: CODES[alternative.index] as TileCode,
        confidence: alternative.value,
      })),
    };
  });

  return {
    detections,
    imageWidth: image.width,
    imageHeight: image.height,
    durationMs: Date.now() - started,
  };
}
