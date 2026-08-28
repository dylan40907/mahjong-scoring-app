const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Let onnxruntime-react-native install its JSI bindings under bridgeless
 * React Native.
 *
 * React Native 0.86 is bridgeless-only - the old architecture was removed in
 * 0.82, and Expo SDK 55 and later cannot disable the new one. Bridgeless has
 * no CatalystInstance. onnxruntime-react-native 1.24.3, the latest published
 * version, still reaches the call invoker through it:
 *
 *     getReactApplicationContext().getCatalystInstance().getJSCallInvokerHolder()
 *
 * That throws, `install()` catches the exception and returns false, and the
 * failure is completely silent: the native library is compiled into the APK
 * for all four ABIs, the module is linked, and JavaScript sees nothing. The
 * capture screen then falls through to manual tile entry as if no build had
 * ever happened.
 *
 * `ReactContext.getJSCallInvokerHolder()` is declared abstract on ReactContext
 * itself and implemented by both BridgeReactContext and the bridgeless one, so
 * the replacement is correct under either architecture rather than a swap of
 * one assumption for another.
 *
 * Same reasoning as with-onnxruntime-gradle9-fix: a config plugin needs no
 * postinstall hook, EAS runs prebuild on the build server, and this is
 * idempotent and self-disabling once upstream fixes it.
 */

const BROKEN = 'getReactApplicationContext().getCatalystInstance().getJSCallInvokerHolder()';
const FIXED = 'getReactApplicationContext().getJSCallInvokerHolder()';

function locateModuleSource(projectRoot) {
  try {
    const packageJson = require.resolve('onnxruntime-react-native/package.json', {
      paths: [projectRoot],
    });
    return path.join(
      path.dirname(packageJson),
      'android/src/main/java/ai/onnxruntime/reactnative/OnnxruntimeModule.java',
    );
  } catch {
    return null;
  }
}

/** Exported for the unit test; pure string in, string out. */
function applyFix(source) {
  if (!source.includes(BROKEN)) return { changed: false, source };
  return { changed: true, source: source.split(BROKEN).join(FIXED) };
}

const withOnnxRuntimeBridgelessFix = (config) =>
  withDangerousMod(config, [
    'android',
    (innerConfig) => {
      const file = locateModuleSource(innerConfig.modRequest.projectRoot);
      if (!file || !fs.existsSync(file)) {
        console.warn('[onnxruntime-bridgeless-fix] module source not found; skipping.');
        return innerConfig;
      }

      const { changed, source } = applyFix(fs.readFileSync(file, 'utf8'));
      if (changed) {
        fs.writeFileSync(file, source, 'utf8');
        console.log('[onnxruntime-bridgeless-fix] Routed JSI install around CatalystInstance.');
      } else {
        console.log('[onnxruntime-bridgeless-fix] Nothing to patch; already compatible.');
      }
      return innerConfig;
    },
  ]);

module.exports = withOnnxRuntimeBridgelessFix;
module.exports.applyFix = applyFix;
module.exports.BROKEN = BROKEN;
module.exports.FIXED = FIXED;
