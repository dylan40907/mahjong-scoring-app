const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Make onnxruntime-react-native evaluate under Gradle 9.
 *
 * Expo SDK 57 builds with Gradle 9.3.1. onnxruntime-react-native 1.24.3 - the
 * latest published version - still calls `VersionNumber.parse()` in its
 * android/build.gradle. `VersionNumber` is `org.gradle.util.VersionNumber`, an
 * internal Gradle class that was removed in Gradle 9, so the project fails to
 * evaluate before a single line is compiled:
 *
 *     A problem occurred evaluating project ':onnxruntime-react-native'.
 *     > Could not get unknown property 'VersionNumber'
 *
 * The comparison guards a branch that only applies to React Native below 0.71.
 * The same file already computes REACT_NATIVE_MINOR_VERSION a few lines above,
 * so the replacement is exactly equivalent and does not change behaviour on any
 * React Native version - it just expresses the test with something that still
 * exists.
 *
 * Done as a config plugin rather than with patch-package so it needs no
 * postinstall hook: EAS runs prebuild on the build server, dangerous mods run
 * during it, and Gradle reads the file afterwards. It is idempotent and a
 * no-op once upstream fixes this, so it can be deleted without ceremony.
 */

const BROKEN = 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {';
const FIXED = 'if (REACT_NATIVE_MINOR_VERSION < 71) {';

function locateBuildGradle(projectRoot) {
  try {
    const packageJson = require.resolve('onnxruntime-react-native/package.json', {
      paths: [projectRoot],
    });
    return path.join(path.dirname(packageJson), 'android', 'build.gradle');
  } catch {
    return null;
  }
}

/** Exported for the unit test; pure string in, string out. */
function applyFix(source) {
  if (!source.includes(BROKEN)) return { changed: false, source };
  return { changed: true, source: source.replace(BROKEN, FIXED) };
}

const withOnnxRuntimeGradle9Fix = (config) =>
  withDangerousMod(config, [
    'android',
    (innerConfig) => {
      const file = locateBuildGradle(innerConfig.modRequest.projectRoot);
      if (!file || !fs.existsSync(file)) {
        console.warn('[onnxruntime-gradle9-fix] package not found; skipping.');
        return innerConfig;
      }

      const { changed, source } = applyFix(fs.readFileSync(file, 'utf8'));
      if (changed) {
        fs.writeFileSync(file, source, 'utf8');
        console.log('[onnxruntime-gradle9-fix] Replaced VersionNumber check for Gradle 9.');
      } else {
        console.log('[onnxruntime-gradle9-fix] Nothing to patch; already compatible.');
      }
      return innerConfig;
    },
  ]);

module.exports = withOnnxRuntimeGradle9Fix;
module.exports.applyFix = applyFix;
module.exports.BROKEN = BROKEN;
module.exports.FIXED = FIXED;
