/**
 * Turning an Expo asset into a path ONNX Runtime can open.
 *
 * Its own module for the same reason `frame.ts` is: `detector.ts` imports
 * `expo-asset`, `expo-image-manipulator` and the native runtime, none of which
 * survive being pulled into ts-jest. Pure geometry and pure string handling
 * live apart so they can be tested without a device, and this is exactly the
 * kind of one-line transformation that is wrong in a way no type catches.
 */

/**
 * The filesystem path behind an asset's URI.
 *
 * Expo hands back `file:///var/mobile/.../detector.onnx` on iOS. The library
 * passes whatever string it is given straight through JSI into `Ort::Session`,
 * which wants a path and has never heard of a URL - and nothing in the library
 * between here and there strips the scheme.
 *
 * That is why this was iOS-only. On Android the asset resolves inside the APK
 * and never acquires a `file://` prefix, so the same line worked on one
 * platform and threw on the other, and the failure surfaced as "the models
 * could not be loaded" - which reads like a missing file rather than a mangled
 * path.
 */
export function assetPath(asset: { localUri?: string | null; uri: string }): string {
  const uri = asset.localUri ?? asset.uri;
  if (!uri.startsWith('file://')) return uri;

  const withoutScheme = uri.replace(/^file:\/\//, '');
  try {
    // A cache directory containing a space arrives as `%20`, which opens no
    // file either.
    return decodeURI(withoutScheme);
  } catch {
    // A stray percent makes `decodeURI` throw. The raw path is still likelier
    // to open than one with a scheme on it, and a loader is not the place to
    // raise an exception over a directory name.
    return withoutScheme;
  }
}
