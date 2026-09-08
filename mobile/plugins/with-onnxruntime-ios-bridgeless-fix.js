const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Let onnxruntime-react-native install its JSI bindings on iOS under
 * bridgeless React Native.
 *
 * The exact bug `with-onnxruntime-bridgeless-fix` solves on Android, in the
 * other language. `OnnxruntimeModule.mm` reaches the JS runtime through the
 * bridge:
 *
 *     RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;
 *     if (cxxBridge == nil) { return @false; }
 *
 * Under bridgeless there is no bridge, so `_bridge` is nil, `install()`
 * returns false, and nothing anywhere says so. The library is compiled into
 * the app and linked, the native module resolves, and JavaScript simply never
 * gets an `InferenceSession`. The capture screen then falls through to manual
 * entry exactly as it would on a device that had never had the models - which
 * is how this shipped to TestFlight looking like a detector that could not see
 * a hand of tiles a foot from the lens.
 *
 * The replacement is the supported path rather than another way round the
 * back. `RCTTurboModuleManager` offers every module it creates the runtime and
 * the call invoker directly, if the module implements the selector:
 *
 *     if ([module respondsToSelector:@selector(installJSIBindingsWithRuntime:callInvoker:)])
 *
 * That is checked by `respondsToSelector`, so it applies to a legacy bridge
 * module going through the interop layer as much as to a TurboModule, and it
 * hands over the same two things the bridge used to - without needing a bridge
 * to exist.
 *
 * `install()` stays, because the JavaScript side calls it at import time and
 * expects a truthy answer; it now reports success when the bindings are
 * already in place instead of insisting on doing the work itself.
 *
 * Idempotent and self-disabling: if upstream fixes this, nothing matches and
 * the plugin does nothing. Delete it and unregister it from app.json then.
 */

const HEADER_ANCHOR = `#import <React/RCTBridgeModule.h>

@interface OnnxruntimeModule : NSObject <RCTBridgeModule>`;

const HEADER_FIXED = `#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>

@interface OnnxruntimeModule : NSObject <RCTBridgeModule, RCTTurboModuleWithJSIBindings>`;

const INSTALL_ANCHOR = `/**
 * React native binding API to install onnxruntime JSI API
 */
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  @try {
    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;`;

const INSTALL_FIXED = `/**
 * Bridgeless: the runtime and the call invoker arrive here, not through a
 * bridge. Patched in by with-onnxruntime-ios-bridgeless-fix.
 */
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime&)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker>&)callInvoker {
  env = onnxruntimejsi::install(runtime, callInvoker);
}

/**
 * React native binding API to install onnxruntime JSI API
 */
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  @try {
    // Already installed by the TurboModule hook above, which is the only path
    // that runs when there is no bridge to ask.
    if (env != nullptr) {
      return @true;
    }
    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;`;

/** Exported for the unit test; pure strings in, strings out. */
function applyFix(header, implementation) {
  const headerChanged = header.includes(HEADER_ANCHOR);
  const implChanged = implementation.includes(INSTALL_ANCHOR);
  return {
    changed: headerChanged || implChanged,
    header: headerChanged ? header.replace(HEADER_ANCHOR, HEADER_FIXED) : header,
    implementation: implChanged
      ? implementation.replace(INSTALL_ANCHOR, INSTALL_FIXED)
      : implementation,
  };
}

function locateIosSources(projectRoot) {
  try {
    const packageJson = require.resolve('onnxruntime-react-native/package.json', {
      paths: [projectRoot],
    });
    const ios = path.join(path.dirname(packageJson), 'ios');
    return {
      header: path.join(ios, 'OnnxruntimeModule.h'),
      implementation: path.join(ios, 'OnnxruntimeModule.mm'),
    };
  } catch {
    return null;
  }
}

const withOnnxRuntimeIosBridgelessFix = (config) =>
  withDangerousMod(config, [
    'ios',
    (innerConfig) => {
      const files = locateIosSources(innerConfig.modRequest.projectRoot);
      if (!files || !fs.existsSync(files.header) || !fs.existsSync(files.implementation)) {
        console.warn('[onnxruntime-ios-bridgeless-fix] module source not found; skipping.');
        return innerConfig;
      }

      const result = applyFix(
        fs.readFileSync(files.header, 'utf8'),
        fs.readFileSync(files.implementation, 'utf8'),
      );

      if (result.changed) {
        fs.writeFileSync(files.header, result.header, 'utf8');
        fs.writeFileSync(files.implementation, result.implementation, 'utf8');
        console.log('[onnxruntime-ios-bridgeless-fix] Routed JSI install around the bridge.');
      } else {
        console.log('[onnxruntime-ios-bridgeless-fix] Nothing to patch; already compatible.');
      }
      return innerConfig;
    },
  ]);

module.exports = withOnnxRuntimeIosBridgelessFix;
module.exports.applyFix = applyFix;
module.exports.HEADER_ANCHOR = HEADER_ANCHOR;
module.exports.INSTALL_ANCHOR = INSTALL_ANCHOR;
