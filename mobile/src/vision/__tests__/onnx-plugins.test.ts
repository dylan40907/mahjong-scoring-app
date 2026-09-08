import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports */
const androidFix = require('../../../plugins/with-onnxruntime-bridgeless-fix.js');
const iosFix = require('../../../plugins/with-onnxruntime-ios-bridgeless-fix.js');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The two patches that make on-device inference work at all.
 *
 * Both plugins find a known string in `onnxruntime-react-native` and rewrite
 * it. When that string stops matching - a version bump, an upstream tidy-up -
 * the plugin does nothing, says "already compatible", and the build succeeds.
 * The app then ships with the native library compiled in, the module linked,
 * and JavaScript quietly unable to get an inference session. Capture falls
 * through to manual entry exactly as it would on a device with no models.
 *
 * That is not hypothetical. It is what happened on iOS: the Android half was
 * patched, the iOS half was not, and the first TestFlight build read zero
 * tiles from a photograph of fourteen with nothing anywhere reporting a
 * problem.
 *
 * So these run against the real installed sources rather than a fixture. The
 * point is to fail on the dependency bump that silently disarms them, which a
 * fixture copied into the repo could never do.
 *
 * What they assert is the *end state*, not the starting one. `withDangerousMod`
 * rewrites `node_modules` in place, so a machine that has run a prebuild
 * already holds patched sources - the Android file here does. Demanding the
 * broken form would then fail on exactly the machines where everything is
 * working. Recognising neither form is the real failure, and that is what is
 * checked.
 */

const ORT = join(__dirname, '../../../node_modules/onnxruntime-react-native');

const read = (relative: string) => readFileSync(join(ORT, relative), 'utf8');

describe('the Android bridgeless patch', () => {
  const source = () =>
    read('android/src/main/java/ai/onnxruntime/reactnative/OnnxruntimeModule.java');

  it('still recognises the installed package', () => {
    // Either state is fine; a third means upstream moved and the plugin is
    // now a no-op that nobody will notice until inference is missing again.
    const text = source();
    expect(text.includes(androidFix.BROKEN) || text.includes(androidFix.FIXED)).toBe(true);
  });

  it('leaves the call invoker reached without CatalystInstance', () => {
    const { source: patched } = androidFix.applyFix(source());
    expect(patched).toContain(androidFix.FIXED);
    expect(patched).not.toContain(androidFix.BROKEN);
  });

  it('does nothing the second time', () => {
    const once = androidFix.applyFix(source()).source;
    expect(androidFix.applyFix(once).changed).toBe(false);
  });
});

describe('the iOS bridgeless patch', () => {
  const header = () => read('ios/OnnxruntimeModule.h');
  const implementation = () => read('ios/OnnxruntimeModule.mm');

  it('still recognises the installed package', () => {
    const h = header();
    const m = implementation();
    expect(h.includes(iosFix.HEADER_ANCHOR) || h.includes('RCTTurboModuleWithJSIBindings')).toBe(
      true,
    );
    expect(m.includes(iosFix.INSTALL_ANCHOR) || m.includes('installJSIBindingsWithRuntime')).toBe(
      true,
    );
  });

  it('declares the protocol that gets the runtime without a bridge', () => {
    const result = iosFix.applyFix(header(), implementation());
    expect(result.header).toContain('RCTTurboModuleWithJSIBindings');
    expect(result.header).toContain('#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>');
  });

  it('installs the bindings from the runtime it is handed', () => {
    const { implementation: patched } = iosFix.applyFix(header(), implementation());
    expect(patched).toContain('installJSIBindingsWithRuntime:(facebook::jsi::Runtime&)runtime');
    expect(patched).toContain('env = onnxruntimejsi::install(runtime, callInvoker);');
  });

  it('lets the JavaScript side keep calling install()', () => {
    // `binding.js` calls this at import time and throws on a falsy answer, so
    // the method has to survive and report success once the bindings are in.
    const { implementation: patched } = iosFix.applyFix(header(), implementation());
    expect(patched).toContain('RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install)');
    expect(patched).toContain('if (env != nullptr) {');
  });

  it('does nothing the second time', () => {
    const once = iosFix.applyFix(header(), implementation());
    expect(iosFix.applyFix(once.header, once.implementation).changed).toBe(false);
  });
});
