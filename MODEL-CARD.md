# Model card

Two small convolutional networks, trained from scratch on synthetic data, that
turn a photograph of a mahjong hand into an ordered list of tiles.

## At a glance

| | Detector | Classifier |
|---|---|---|
| Task | Locate every tile (1 class) | Name one tile (42 classes) |
| Input | 320x320 RGB letterbox | 48x64 RGB crop |
| Parameters | 289,445 | 159,210 |
| Exported size | 1.17 MB ONNX | 0.64 MB ONNX |
| Architecture | Anchor-free centre-point head on a separable-conv backbone | Four separable-conv stages, global pool, linear |

Both run on the CPU. Both were trained on two CPU cores.

## Results on the held-out test split

500 scenes, 6526 tile instances. Neither model saw this split during
training or validation.

### Detection

| Metric | Value |
|---|---|
| AP@0.5 | 0.9950 |
| Precision @ 0.35 confidence | 0.9954 |
| Recall @ 0.35 confidence | 0.9951 |

### Classification, on detector-produced crops

Measured only on the 6,494 tiles the detector found, so this is the
classifier's own accuracy rather than the pipeline's.

| Metric | Value |
|---|---|
| Top-1 | 0.9998 |
| Top-3 | 0.9998 |

That is one misread tile in 6,494. It is the clearest evidence that
splitting the pipeline was the right call: recognising a tile from a
full-resolution crop is nearly free, and all the remaining error is in finding
the tiles at all. It also means the weakest-class table is uninformative —
almost every class sits at 1.000 — so it is omitted.

### End to end

| Metric | Value |
|---|---|
| Per-tile accuracy | 0.9949 |
| Hand read perfectly | 0.9080 |
| Tile count correct | 0.9120 |

Per-tile accuracy counts every tile in the ground truth, including ones the
detector never found — unlike the classifier figure above, which cannot count
what it never saw.

"Hand read perfectly" means every tile in a scene was found *and* named
correctly: no misses, no extras, no misreads. It is much harsher than the
component figures and it is the number that describes what a user experiences.
A 13-tile hand is 13 independent chances to
be wrong, so 99.49% per-tile accuracy does not mean
99.49% of hands come out clean — it means about
91% do.

The gap is entirely detection. Both failure modes show up at the frame edge: a
tile clipped by the crop is either missed or hallucinated. Framing the hand
fully, which the capture screen asks for, avoids most of it.

### Choosing the operating threshold

The detection confidence threshold trades misses against false positives, and
AP hides the choice by integrating over all of them. Swept against the metric
the app actually cares about:

| Threshold | Hand read perfectly | Tile count correct |
|---|---|---|
| 0.20 | 0.828 | 0.828 |
| 0.30 | 0.906 | 0.914 |
| 0.35 | 0.908 | 0.912 |
| 0.40 | 0.874 | 0.880 |
| 0.50 | 0.736 | 0.738 |
| 0.60 | 0.326 | 0.328 |

The app ships at 0.35. The curve is sharply peaked: lower and partial tiles at the frame edge start being detected as whole ones, higher and genuine tiles are dropped.

### Latency

43.4 ms median per photograph, 53.5 ms at the 95th
percentile, measured single-threaded on two shared CPU cores in this
environment. A phone is faster; treat these as an upper bound.

## Training data

Entirely synthetic. No public annotated mahjong dataset was reachable from the
build environment — Roboflow, Kaggle and HuggingFace are all blocked by the
network proxy — and generation turned out to be the better option regardless:
labels are exact by construction, rare tiles can be oversampled, and every
nuisance factor becomes a parameter rather than a hope.

| Split | Scenes | Tile instances |
|---|---|---|
| Train | 5,999 | ~78,700 |
| Validation | 700 | 9,370 |
| Test | 500 | 6,526 |

Tile faces are rendered from a CC0 SVG set; flowers, seasons and the framed
white dragon are drawn procedurally, since a Riichi set contains none of them.
Scenes vary in layout (single row, row with melds set apart, two rows, bonus
spreads), table surface (felt, wood, cloth), camera angle (perspective to about
35 degrees, roll, framing crop), lighting, white balance, glare, blur, sensor
noise and JPEG quality. Hands, sleeves and cast shadows intrude from the frame
edge in roughly a third of scenes.

Hands are drawn without replacement from a real 144-tile wall, so duplicates are
naturally limited to four of a kind. A tenth of scenes are deliberately
flower-and-season heavy, since bonus tiles are 8 of 144 and would otherwise be
starved: per-class support in the training crops ranges from 851 to
2207.

## Known limitations

**Trained on rendered tiles, not photographed ones.** This is the single
biggest caveat. The synthetic pipeline models the nuisance factors of real
photography carefully, but it renders one tile design. A physical set with
different engraving, a different bone colour, or heavier wear is out of
distribution, and the numbers above do not predict performance on it. The
honest next step is a few dozen photographs of a real set, used as a
calibration and evaluation set rather than as training data.

**Face-up tiles only.** The detector is trained on tiles lying flat and face up.
Tiles standing in a rack, seen edge-on, or face down are not represented.

**No occlusion recovery.** A tile more than about 45% hidden is dropped from the
ground truth during generation and will simply not be detected. The review
screen makes adding it a tap, which is the intended handling.

**Closed set.** 42 classes, no "unknown". Anything tile-shaped that is not one
of the 42 will be confidently named as whichever it most resembles.

## Reproducing

```bash
cd ml
pip install -r requirements.txt
python src/render_tiles.py
python src/synth.py --out data/train_a --count 3000 --seed 11
python src/synth.py --out data/train_b --count 3000 --seed 12
python src/synth.py --out data/val --count 700 --seed 21
python src/synth.py --out data/test --count 500 --seed 22
python src/build_crops.py --roots data/train_a data/train_b --out crops/train --seed 1
python src/build_crops.py --roots data/val --out crops/val --seed 5
python src/train_detector.py --train-roots data/train_a data/train_b --val-root data/val --out runs
python src/train_classifier.py --train-store crops/train --val-store crops/val --out runs
python src/evaluate.py --roots data/test --runs runs
python src/export_onnx.py --out ../mobile/assets/models
```

Checkpoints selected: detector epoch 20 (validation AP@0.5
0.9998), classifier epoch 16 (validation top-1
0.9990).

## Export

Both models export to ONNX at opset 17 and are verified numerically against
PyTorch after export; the largest observed disagreement is at float32 rounding
level. The detector's decoding — sigmoid, 3x3 max-pool peak-finding, top-k,
box assembly — is fused into the exported graph, so the app receives boxes and
scores rather than raw feature maps. Post-processing implemented twice is
post-processing implemented differently.

## What the failures look like

![Predictions on held-out test scenes](images/predictions.png)

Grey boxes are ground truth, green are correct predictions, red are wrong. The
two failures visible here are both at the frame edge: one tile clipped by the
crop was missed, and one partial tile was detected as a whole one. That is the
characteristic failure mode and the reason the capture screen asks for the hand
to fill the frame.
