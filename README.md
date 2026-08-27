# Mahjong Scorer

Photograph a winning mahjong hand; get it read, ordered and scored.

A two-stage computer-vision pipeline finds the tiles in a photograph and
identifies each one, a geometry pass recovers the order a player would read
them in, and a rules engine scores the result against any of four regional
scoring systems — or one you define yourself.

![Every screen](mobile/screenshots/00-all-screens.png)

---

## What it does

**Reads a hand from a photograph.** A custom detector locates every tile; a
custom classifier names each one from a full-resolution crop. Both models were
trained from scratch and together weigh under 2 MB, so inference runs on the
phone with no network.

**Puts the tiles in order.** Detections come back in confidence order, which is
useless for scoring. A geometry pass measures the table's rotation from the
tiles themselves, groups them into rows, and splits melds from the concealed
hand on spacing.

**Scores it, and shows its working.** Ninety-nine scoring patterns, four
rulesets, and a settlement for each: who pays whom and how much. Every pattern
that matched is listed with what it was worth, because the point of an
automatic scorer at a real table is settling the argument, not just producing a
number.

**Tracks a session.** Four players, seats and winds, the deal passing on a
loss, and running totals that always sum to zero.

## Rulesets

| Ruleset | Hand | Scored in | Notes |
|---|---|---|---|
| Taiwanese | 16 tiles | 台 (tai) | The everyday table: 30 base, 10 per tai |
| Taiwanese (Reference Table) | 16 tiles | 台 (tai) | The published Four Winds values, capped at 40 |
| Hong Kong Old Style | 13 tiles | 番 (faan) | Faan doubling into a flattening table |
| Hong Kong (3 Faan Minimum) | 13 tiles | 番 (faan) | The same table with a floor |
| Japanese Riichi | 13 tiles | han + fu | Yaku required; full fu accumulation |
| Chinese Official (MCR) | 13 tiles | points | 81 fan elements, 8-point minimum |

Any of them can be cloned and edited — every pattern's value, or whether it
counts at all. A custom ruleset is the same kind of object as a built-in one,
so nothing about it is second class.

## How it is put together

```
ml/                    Python: tile art, synthetic data, training, export
  src/tileset.py       The 42 classes. Source of truth for both sides.
  src/render_tiles.py  CC0 SVG set -> 42 PNG faces (flowers drawn in)
  src/synth.py         Procedural scenes with exact ground truth
  src/models.py        The detector and classifier, written from scratch
  src/train_*.py       CPU training, checkpointed and time-bounded
  src/evaluate.py      Component and end-to-end metrics
  src/export_onnx.py   ONNX export with numeric verification

mobile/                Expo app (SDK 57, Expo Router, TypeScript)
  src/tiles/           Generated from ml/src/tileset.py
  src/scoring/         The rules engine: decomposition, patterns, payouts
  src/vision/          Preprocessing, inference, spatial ordering
  src/design/          Tokens, icons, components
  src/app/             Screens
```

Two generated files keep the halves honest. `mobile/src/tiles/tileset.ts` and
the bundled asset map are emitted from `ml/src/tileset.py`, so the class order
baked into the classifier cannot drift from the app's idea of it. And
`mobile/src/vision/__tests__/parity.json` holds reference tensors from the
training pipeline that the app's preprocessing is checked against.

## Running it

```bash
cd mobile && npm install
npx expo start            # needs a development build; see EAS.md
```

The models are already exported into `mobile/assets/models/`. To rebuild them:

```bash
cd ml
pip install -r requirements.txt
python src/render_tiles.py
python src/synth.py --out data/train --count 6000 --seed 11
python src/build_crops.py --roots data/train --out crops/train
python src/train_detector.py --train-roots data/train --val-root data/val --out runs
python src/train_classifier.py --train-store crops/train --val-store crops/val --out runs
python src/export_onnx.py --out ../mobile/assets/models
```

Tests:

```bash
cd mobile && npx jest        # scoring, ordering, preprocessing parity
npx tsc --noEmit             # typecheck
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — why the pipeline is split in two, and what each stage owes the next
- [`docs/model-card.md`](docs/model-card.md) — training data, metrics, and where the models fail
- [`docs/rulesets.md`](docs/rulesets.md) — how scoring is expressed as data, and how to write your own
- [`EAS.md`](EAS.md) — builds and over-the-air updates

## Credits

Tile faces derive from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
(CC0). Flowers, seasons and the framed white dragon are drawn by
`ml/src/render_tiles.py`, since a Riichi set contains none of them.
