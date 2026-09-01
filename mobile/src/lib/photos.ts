import { Directory, File, Paths } from 'expo-file-system';

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
