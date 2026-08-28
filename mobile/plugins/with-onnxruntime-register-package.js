const { withMainApplication } = require('expo/config-plugins');

/**
 * Register OnnxruntimePackage by hand, because nothing else does.
 *
 * onnxruntime-react-native ships a `unimodule.json` - the *legacy* Expo module
 * marker - so Expo's autolinking claims it and lists it among "Using expo
 * modules" during the build. Expo then registers it through
 * ExpoModulesPackage, which looks for classes implementing Expo's `Module`
 * interface. `OnnxruntimeModule` is a plain ReactContextBaseJavaModule inside a
 * plain `OnnxruntimePackage : ReactPackage`, so Expo finds nothing to register,
 * and because Expo claimed the package React Native's own autolinking does not
 * add it to PackageList either.
 *
 * The result is a library that compiles, links its native libraries for all
 * four ABIs, and is completely absent from the JavaScript side:
 *
 *     TurboModuleRegistry.getEnforcing(...): 'Onnxruntime' could not be found.
 *     Verify that a module by this name is registered in the native binary.
 *
 * MainApplication's package list is the documented escape hatch for exactly
 * this - its generated body carries a comment inviting packages that cannot be
 * autolinked. Adding it there is the same thing a bare React Native project
 * would do.
 *
 * Delete this, with-onnxruntime-bridgeless-fix and with-onnxruntime-gradle9-fix
 * together if the library ever ships a real Expo module config; all three are
 * idempotent and no-ops once that happens.
 */

const ANCHOR = 'PackageList(this).packages.apply {';
const REGISTRATION = '      add(ai.onnxruntime.reactnative.OnnxruntimePackage())';

/** Exported for the unit test; pure string in, string out. */
function applyFix(source) {
  if (source.includes('OnnxruntimePackage()')) return { changed: false, source };
  if (!source.includes(ANCHOR)) return { changed: false, source, missingAnchor: true };
  return {
    changed: true,
    source: source.replace(ANCHOR, `${ANCHOR}\n${REGISTRATION}`),
  };
}

const withOnnxRuntimeRegisterPackage = (config) =>
  withMainApplication(config, (innerConfig) => {
    if (innerConfig.modResults.language !== 'kt') {
      console.warn('[onnxruntime-register-package] MainApplication is not Kotlin; skipping.');
      return innerConfig;
    }

    const { changed, source, missingAnchor } = applyFix(innerConfig.modResults.contents);
    if (missingAnchor) {
      // Loud rather than silent: a missed registration looks exactly like a
      // model that will not load, and costs a twenty-minute build to notice.
      throw new Error(
        '[onnxruntime-register-package] Could not find the package list in MainApplication. ' +
          'The generated template changed; update ANCHOR in this plugin.',
      );
    }

    if (changed) {
      innerConfig.modResults.contents = source;
      console.log('[onnxruntime-register-package] Registered OnnxruntimePackage.');
    } else {
      console.log('[onnxruntime-register-package] Already registered.');
    }
    return innerConfig;
  });

module.exports = withOnnxRuntimeRegisterPackage;
module.exports.applyFix = applyFix;
module.exports.ANCHOR = ANCHOR;
module.exports.REGISTRATION = REGISTRATION;
