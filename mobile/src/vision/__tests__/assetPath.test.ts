/**
 * Turning an Expo asset into a path ONNX Runtime can open.
 *
 * This was an iOS-only failure that looked like a missing model. Expo hands
 * back `file:///var/mobile/.../detector.onnx`; the library passes the string
 * straight through JSI into `Ort::Session`, which wants a filesystem path and
 * has never heard of a URL. On Android the asset resolves inside the APK and
 * never picks up the scheme, so the identical line worked on one platform and
 * threw on the other.
 *
 * Tested through the exported helper rather than through `loadSessions`,
 * because loading a session needs the native module and the point of the bug
 * was that everything native was working fine.
 */
import { assetPath } from '../assetPath';

describe('the path handed to ONNX Runtime', () => {
  it('strips the scheme iOS puts on a cached asset', () => {
    expect(assetPath({ localUri: 'file:///var/mobile/app/detector.onnx', uri: 'x' })).toBe(
      '/var/mobile/app/detector.onnx',
    );
  });

  it('leaves a bare path alone', () => {
    // Android resolves inside the APK and never acquires a scheme. Rewriting
    // that would break the platform that was working.
    expect(assetPath({ localUri: '/data/app/base.apk!/assets/detector.onnx', uri: 'x' })).toBe(
      '/data/app/base.apk!/assets/detector.onnx',
    );
  });

  it('decodes an escaped directory name', () => {
    // A cache path containing a space arrives percent-encoded and opens no
    // file in that form.
    expect(
      assetPath({ localUri: 'file:///var/My%20Data/detector.onnx', uri: 'x' }),
    ).toBe('/var/My Data/detector.onnx');
  });

  it('falls back to the asset uri when there is no local copy', () => {
    expect(assetPath({ localUri: null, uri: 'https://cdn/detector.onnx' })).toBe(
      'https://cdn/detector.onnx',
    );
  });

  it('survives a malformed escape rather than throwing', () => {
    // `decodeURI` throws on a stray percent. A raw path is still likelier to
    // open than one with a scheme on it, and inference failing is not worth an
    // exception thrown from the loader.
    expect(assetPath({ localUri: 'file:///var/100%/detector.onnx', uri: 'x' })).toBe(
      '/var/100%/detector.onnx',
    );
  });
});
