# Mahjong Scorer — start here

Everything is in `MahjongScoringApp.zip`. Extract it into this folder and you
have the whole project: app, models, training code, docs.

```
MahjongScoringApp/
├── README.md              What it is and how it fits together
├── EAS.md                 Builds and over-the-air updates
├── docs/
│   ├── architecture.md    Why the pipeline is split in two
│   ├── model-card.md      Training data, metrics, and where it fails
│   ├── rulesets.md        How scoring is expressed as data
│   └── resume.md          Rewritten resume bullets, with the real numbers
├── ml/                    Python: tile art, synthetic data, training, export
└── mobile/                The Expo app (models already exported into it)
```

## Running it

```bash
cd MahjongScoringApp/mobile
npm install
npm install -g eas-cli                 # the package is eas-cli, the binary is `eas`
eas login && eas init                  # fills in your project id
eas build --profile development --platform android
```

Install the APK, then `npx expo start --dev-client`. It needs a development
build rather than Expo Go — ONNX Runtime and the camera are native modules.

To see the interface without a build:

```bash
npm run export:web && npm run screenshots
```

To check the logic:

```bash
npm test          # 84 tests: scoring, ordering, preprocessing parity
npm run typecheck
npm run lint
```

## Where the models came from

Both were trained from scratch on synthetic data, because no public annotated
mahjong dataset was reachable from my environment (Roboflow, Kaggle and
HuggingFace are all blocked by the network proxy there). `docs/model-card.md`
has the full picture, including the one caveat that matters: they have only
ever seen rendered tiles, never photographs of a physical set.

## Two things for you

1. **`PERMISSION_TEST.txt`** in this folder is mine — the write-back test from
   the start of the session. Safe to delete.
2. **The best next step is photographs.** Sixty to a hundred phone photos of a
   real tile set, in varied lighting and at varied angles, would let the models
   be fine-tuned and — more importantly — honestly evaluated on the thing they
   are actually for. Drop them in a folder and it is a short job.
