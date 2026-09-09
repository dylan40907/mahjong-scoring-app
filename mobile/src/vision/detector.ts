import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { Asset } from 'expo-asset';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode as decodeJpeg } from 'jpeg-js';
import type { InferenceSession as OrtSession, Tensor as OrtTensor } from 'onnxruntime-react-native';
import { CODES, type TileCode } from '@/tiles/tileset';
import { assetPath } from './assetPath';
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
/**
 * Swept against whole-hand accuracy on every held-out split.
 *
 * 0.35 and 0.40 are within noise of each other - about two scenes - but 0.35
 * wins on the one benchmark the models have never trained on (0.620 against
 * 0.609), and it sits further from the cliff: accuracy falls away sharply above
 * 0.45 as genuine tiles start being dropped. On an unfamiliar tile set, margin
 * from the cliff is worth more than a tenth of a point on a familiar one.
 *
 * See docs/model-card.md for both sweeps.
 */
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
 * The ONNX native module, however this React Native version exposes it.
 *
 * onnxruntime-react-native 1.24.3 registers a *legacy* bridge module -
 * `OnnxruntimePackage implements ReactPackage`, no `codegenConfig` - and its
 * `binding.js` reaches it with `NativeModules.Onnxruntime` at import time.
 * React Native 0.86 is bridgeless-only, where legacy modules arrive through
 * the TurboModule interop and do not necessarily appear on `NativeModules`.
 * That is why the module can be compiled into the APK (the build log shows it
 * linked for all four ABIs) and still be invisible to JavaScript.
 *
 * Looking it up through both, then writing the result back onto
 * `NativeModules`, is what lets the library's own lookup succeed - it runs
 * when the package is required, which is too early for us to patch afterwards.
 */
function resolveOnnxModule(): unknown {
  if (NativeModules.Onnxruntime != null) return NativeModules.Onnxruntime;

  let viaTurbo: unknown = null;
  try {
    viaTurbo = TurboModuleRegistry.get('Onnxruntime');
  } catch {
    return null;
  }
  if (viaTurbo == null) return null;

  try {
    (NativeModules as Record<string, unknown>).Onnxruntime = viaTurbo;
  } catch {
    // Frozen in some runtimes; the library will fail its own lookup and the
    // capture screen falls through to manual entry, which is the safe path.
  }
  return viaTurbo;
}

/**
 * Whether on-device inference can run here at all.
 *
 * Probed by resolving the native module rather than by importing the package.
 * `onnxruntime-react-native/binding` calls `NativeModules.Onnxruntime.install()`
 * at *import* time, so merely requiring it where the native side is absent
 * throws a TypeError rather than returning something falsy.
 *
 * Environments that legitimately lack it - the web build, and Expo Go, which
 * ships a fixed set of native modules - fall through to manual tile entry,
 * which is a first-class path rather than an error state.
 */
export function isVisionSupported(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  return resolveOnnxModule() != null;
}

/**
 * What the runtime can actually see, for when the module is missing.
 *
 * Without this a failure is indistinguishable from every other failure, and
 * each guess costs a twenty-minute native build. Naming which lookup failed
 * turns that into one build.
 */
export function visionDiagnostics(): string {
  const bridge = NativeModules.Onnxruntime != null ? 'yes' : 'no';

  let turbo: string;
  try {
    // getEnforcing rather than get: it throws with the registry's own
    // explanation, which is the difference between "not registered" and
    // "registered but failed to construct".
    turbo = TurboModuleRegistry.getEnforcing('Onnxruntime') != null ? 'yes' : 'null';
  } catch (error) {
    turbo = `no (${(error as Error).message.slice(0, 90)})`;
  }

  // The JSI global is what inference actually needs; the native module only
  // exists to install it. If this is present the module worked even if the
  // lookups above look odd.
  const ortApi =
    typeof (globalThis as Record<string, unknown>).OrtApi !== 'undefined' ? 'yes' : 'no';

  return `bridge:${bridge} turbo:${turbo} OrtApi:${ortApi}`;
}

/**
 * Why inference is unavailable, phrased for the capture screen.
 *
 * Expo Go and a development build missing the native module produce the same
 * `NativeModules.Onnxruntime == null`, but they need opposite advice: one is
 * "make a development build", the other is "your build is stale, rebuild it".
 * Blaming Expo Go in both cases sends you off to make a build you already have.
 */
export function visionUnavailableReason(): string | null {
  if (isVisionSupported()) return null;
  if (Platform.OS === 'web') {
    return 'Photo reading needs the installed app.';
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return 'Expo Go cannot load the tile models. Everything else works — enter the hand by hand, or open this in the development build to read tiles from photos.';
  }
  return `The tile-reading module did not load in this build. Enter the hand by hand meanwhile.\n\n${visionDiagnostics()}`;
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

      // `assetPath` rather than the raw URI: ONNX Runtime wants a filesystem
      // path and Expo hands back a `file://` URL on iOS. See `assetPath.ts`.
      const detector = await ort.InferenceSession.create(assetPath(detectorAsset), options);
      const classifier = await ort.InferenceSession.create(assetPath(classifierAsset), options);

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

/**
 * Decode just the hand, at the same working width as the whole photograph.
 *
 * This is where re-reading inside a confirmed boundary earns its keep. A hand
 * occupying a fifth of the frame gets a fifth of the detector's 320 pixels on
 * the first pass; cropped to it, the same hand fills them. The tiles arrive
 * several times larger with no change to either model.
 *
 * `region` is in the coordinate space of the *full* decoded image, because
 * that is what the boxes and the on-screen boundary are both expressed in.
 * Returned alongside is the mapping that puts boxes found here back into that
 * space: the crop is always resized to the same working width, so the factor
 * collapses to `regionWidth / MAX_SOURCE_WIDTH`.
 */
async function decodeRegion(
  uri: string,
  region: readonly [number, number, number, number],
): Promise<{ image: RgbaImage; factor: number; offsetX: number; offsetY: number }> {
  // The crop has to be expressed in the original file's pixels, so ask what
  // those are. No base64, so this does not decode anything.
  const probe = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const fullScale = MAX_SOURCE_WIDTH / probe.width;
  const originX = Math.max(0, Math.round(region[0] / fullScale));
  const originY = Math.max(0, Math.round(region[1] / fullScale));
  const width = Math.max(1, Math.min(
    probe.width - originX, Math.round((region[2] - region[0]) / fullScale),
  ));
  const height = Math.max(1, Math.min(
    probe.height - originY, Math.round((region[3] - region[1]) / fullScale),
  ));

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX, originY, width, height } }, { resize: { width: MAX_SOURCE_WIDTH } }],
    { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );

  if (!result.base64) throw new Error('The photo could not be read.');
  const decoded = decodeJpeg(base64ToBytes(result.base64), { useTArray: true });
  return {
    image: { data: decoded.data, width: decoded.width, height: decoded.height },
    factor: (width * fullScale) / MAX_SOURCE_WIDTH,
    offsetX: originX * fullScale,
    offsetY: originY * fullScale,
  };
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export async function detectTiles(
  uri: string,
  options: {
    scoreThreshold?: number;
    /**
     * Read only this rectangle, in full-image pixels. Boxes still come back in
     * full-image coordinates, so callers do not have to know a crop happened.
     */
    region?: readonly [number, number, number, number];
  } = {},
): Promise<DetectionResult> {
  const started = Date.now();
  const threshold = options.scoreThreshold ?? SCORE_THRESHOLD;
  const { detector, classifier } = await loadSessions();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ort = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native');

  // Full-image dimensions are reported whether or not a region was read, so a
  // second pass inside a boundary stays interchangeable with the first.
  let image: RgbaImage;
  let factor = 1;
  let offsetX = 0;
  let offsetY = 0;
  let reportedWidth: number;
  let reportedHeight: number;

  if (options.region) {
    const cropped = await decodeRegion(uri, options.region);
    image = cropped.image;
    factor = cropped.factor;
    offsetX = cropped.offsetX;
    offsetY = cropped.offsetY;
    const full = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const fullScale = MAX_SOURCE_WIDTH / full.width;
    reportedWidth = MAX_SOURCE_WIDTH;
    reportedHeight = Math.round(full.height * fullScale);
  } else {
    image = await decodeImage(uri);
    reportedWidth = image.width;
    reportedHeight = image.height;
  }

  const toFullImage = (box: [number, number, number, number]): [number, number, number, number] => [
    box[0] * factor + offsetX,
    box[1] * factor + offsetY,
    box[2] * factor + offsetX,
    box[3] * factor + offsetY,
  ];

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
    return {
      detections: [],
      imageWidth: reportedWidth,
      imageHeight: reportedHeight,
      durationMs: Date.now() - started,
    };
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
      box: toFullImage(entry.box),
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
    imageWidth: reportedWidth,
    imageHeight: reportedHeight,
    durationMs: Date.now() - started,
  };
}
