# Building and shipping

The app needs a development build rather than Expo Go: ONNX Runtime and the
camera are native modules, and Expo Go ships a fixed set that does not include
them.

## One-time setup

```bash
cd mobile
npm install
npm install -g eas-cli   # the package is eas-cli; its binary is `eas`
eas login
eas init                 # writes your project id and update URL into app.json
```

If you would rather not install it globally, `npx eas-cli@latest <command>`
works everywhere `eas` appears below. Plain `npx eas` does not: npx resolves
the literal package name, and there is no package called `eas`.

`eas init` is what fills in `extra.eas.projectId` and the `updates.url`. Those
are deliberately absent from the committed `app.json`: a placeholder id would
build an app that quietly polls a URL that does not exist.

## Development build

```bash
eas build --profile development --platform android
```

Install the resulting APK, then `npx expo start --dev-client` and scan the
code. Reloads are instant from there; a new native build is only needed when a
native dependency changes.

## Preview and production

```bash
eas build --profile preview --platform android      # shareable APK
eas build --profile production --platform all       # store builds
```

## Over-the-air updates

`runtimeVersion` uses the `appVersion` policy, so an update reaches every build
sharing the app version. JavaScript, the scoring rules and the ONNX models are
all in the update bundle, which means a retrained model or a corrected tai
value ships without a store review:

```bash
eas update --channel production --message "Corrected the seat wind tai value"
```

Bump `version` in `app.json` and rebuild when a native dependency changes —
that starts a new runtime version, and older installs stop receiving the newer
updates rather than crashing on an incompatible bundle.

## Running the web build

Native inference and the camera are unavailable in a browser, and the app falls
back to manual tile entry there. It is still the fastest way to review the
interface:

```bash
npx expo export --platform web --output-dir dist
node tools/screenshot.mjs      # drives the build and writes screenshots/
```
