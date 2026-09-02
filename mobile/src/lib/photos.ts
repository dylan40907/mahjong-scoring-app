import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { CAPTURE_ASPECT, frameCrop } from '@/vision/frame';

/**
 * Keeping the photograph a hand was read from.
 *
 * The camera and the image picker both hand back a URI in a cache directory.
 * That is fine for the few seconds it takes to read the tiles and wrong for
 * anything longer: the system empties those directories whenever it wants, so
 * a hand saved on Thursday can lose its photograph by Saturday with nothing to
 * show for it but a broken image.
 *
 * Copying into the app's own document directory is what makes "open a hand and
 * see the picture" a promise rather than a hope. Copies are named by hand id so
 * deleting a hand can take its photograph with it, and so re-saving the same
 * hand overwrites rather than accumulates.
 */

const FOLDER = 'hands';

function folder(): Directory {
  return new Directory(Paths.document, FOLDER);
}

/**
 * Copy a photograph into permanent storage, returning the new URI.
 *
 * Returns the original URI unchanged if the copy fails. A hand that saves with
 * a fragile photograph is better than one that refuses to save at all, and the
 * review screen already copes with a photograph that will not load.
 */
export async function keepPhoto(sourceUri: string, handId: string): Promise<string> {
  try {
    const directory = folder();
    if (!directory.exists) directory.create({ intermediates: true });

    const source = new File(sourceUri);
    // Preserve the extension so the decoder still recognises the format.
    const extension = sourceUri.split('.').pop()?.split('?')[0] ?? 'jpg';
    const destination = new File(directory, `${handId}.${extension.slice(0, 5)}`);
    if (destination.exists) destination.delete();
    source.copy(destination);
    return destination.uri;
  } catch {
    return sourceUri;
  }
}

/** Remove a hand's photograph. Missing files are not an error. */
export async function discardPhoto(uri: string | undefined): Promise<void> {
  if (!uri) return;
  try {
    // Only ever deletes inside our own folder: a picker URI still pointing at
    // the user's library must not be touched.
    if (!uri.includes(`/${FOLDER}/`)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A photograph that will not delete is not worth failing a delete over.
  }
}

export interface CroppedPhoto {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Crop a photograph to what the capture frame was showing.
 *
 * The camera preview fills the frame and centre-crops the overflow - `cover`
 * in every renderer this app draws on - so reproducing it is the same
 * arithmetic, and `frameCrop` holds it where it can be tested without an
 * image. Doing this at capture time is what makes the viewfinder a promise
 * rather than a suggestion: every stage after it, detection included, works on
 * exactly the rectangle the user framed.
 *
 * Falls back to the original on any failure. A wider photograph than expected
 * is a much smaller problem than a capture that dead-ends.
 */
export async function cropToFrame(
  uri: string,
  width: number,
  height: number,
  aspect: number = CAPTURE_ASPECT,
): Promise<CroppedPhoto> {
  const rect = frameCrop(width, height, aspect);
  if (!rect) return { uri, width, height };

  try {
    const result = await ImageManipulator.manipulateAsync(uri, [{ crop: rect }], {
      compress: 0.95,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: result.uri, width: result.width, height: result.height };
  } catch {
    return { uri, width, height };
  }
}
