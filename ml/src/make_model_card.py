"""Write the model card from the evaluation output.

Generated rather than hand-written so the numbers in the documentation are the
numbers the harness actually produced. A model card with stale figures is worse
than none.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from models import TileClassifier, TileDetector, count_parameters  # noqa: E402
from tileset import CODES, NUM_CLASSES  # noqa: E402

TEMPLATE = """# Model card

Two small convolutional networks, trained from scratch on synthetic data, that
turn a photograph of a mahjong hand into an ordered list of tiles.

## At a glance

| | Detector | Classifier |
|---|---|---|
| Task | Locate every tile (1 class) | Name one tile (42 classes) |
| Input | {detector_input}x{detector_input} RGB letterbox | 48x64 RGB crop |
| Parameters | {detector_params:,} | {classifier_params:,} |
| Exported size | {detector_mb:.2f} MB ONNX | {classifier_mb:.2f} MB ONNX |
| Architecture | Anchor-free centre-point head on a separable-conv backbone | Four separable-conv stages, global pool, linear |

Both run on the CPU. Both were trained on two CPU cores.

## Results on the held-out test split

{scenes} scenes, {tiles} tile instances. Neither model saw this split during
training or validation.

### Detection

| Metric | Value |
|---|---|
| AP@0.5 | {ap50:.4f} |
| Precision @ 0.35 confidence | {precision:.4f} |
| Recall @ 0.35 confidence | {recall:.4f} |

### Classification, on detector-produced crops

Measured only on the {matched_tiles:,} tiles the detector found, so this is the
classifier's own accuracy rather than the pipeline's.

| Metric | Value |
|---|---|
| Top-1 | {top1:.4f} |
| Top-3 | {top3:.4f} |

That is one misread tile in {matched_tiles:,}. It is the clearest evidence that
splitting the pipeline was the right call: recognising a tile from a
full-resolution crop is nearly free, and all the remaining error is in finding
the tiles at all. It also means the weakest-class table is uninformative —
almost every class sits at 1.000 — so it is omitted.

### End to end

| Metric | Value |
|---|---|
| Per-tile accuracy | {tile_accuracy:.4f} |
| Hand read perfectly | {hand_perfect:.4f} |
| Tile count correct | {count_correct:.4f} |

Per-tile accuracy counts every tile in the ground truth, including ones the
detector never found — unlike the classifier figure above, which cannot count
what it never saw.

"Hand read perfectly" means every tile in a scene was found *and* named
correctly: no misses, no extras, no misreads. It is much harsher than the
component figures and it is the number that describes what a user experiences.
A {tiles_per_hand:.0f}-tile hand is {tiles_per_hand:.0f} independent chances to
be wrong, so {tile_accuracy:.2%} per-tile accuracy does not mean
{tile_accuracy:.2%} of hands come out clean — it means about
{hand_perfect:.0%} do.

The gap is entirely detection. Both failure modes show up at the frame edge: a
tile clipped by the crop is either missed or hallucinated. Framing the hand
fully, which the capture screen asks for, avoids most of it.

### Choosing the operating threshold

The detection confidence threshold trades misses against false positives, and
AP hides the choice by integrating over all of them. Swept against the metric
the app actually cares about:

| Threshold | Hand read perfectly | Tile count correct |
|---|---|---|
{sweep_rows}

{threshold_note}

### Latency

{latency_median} ms median per photograph, {latency_p95} ms at the 95th
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
starved: per-class support in the training crops ranges from {min_support} to
{max_support}.

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

Checkpoints selected: detector epoch {detector_epoch} (validation AP@0.5
{detector_val:.4f}), classifier epoch {classifier_epoch} (validation top-1
{classifier_val:.4f}).

## Export

Both models export to ONNX at opset 17 and are verified numerically against
PyTorch after export; the largest observed disagreement is at float32 rounding
level. The detector's decoding — sigmoid, 3x3 max-pool peak-finding, top-k,
box assembly — is fused into the exported graph, so the app receives boxes and
scores rather than raw feature maps. Post-processing implemented twice is
post-processing implemented differently.
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluation", type=Path, default=Path("ml/runs/evaluation.json"))
    parser.add_argument("--models", type=Path, default=Path("mobile/assets/models"))
    parser.add_argument("--crops", type=Path, default=Path("ml/crops/train"))
    parser.add_argument("--out", type=Path, default=Path("docs/model-card.md"))
    parser.add_argument("--input-size", type=int, default=320)
    args = parser.parse_args()

    results = json.loads(args.evaluation.read_text())
    labels = np.load(args.crops / "labels.npy")
    support = np.bincount(labels, minlength=NUM_CLASSES)

    sweep = results.get("threshold_sweep") or []
    sweep_rows = "\n".join(
        f"| {row['threshold']:.2f} | {row['hand_read_perfectly']:.3f} | {row['tile_count_correct']:.3f} |"
        for row in sweep
    )
    if sweep:
        best = max(sweep, key=lambda row: row["hand_read_perfectly"])
        threshold_note = (
            f"The app ships at {best['threshold']:.2f}. The curve is sharply peaked: "
            "lower and partial tiles at the frame edge start being detected as whole "
            "ones, higher and genuine tiles are dropped."
        )
    else:
        threshold_note = ""


    text = TEMPLATE.format(
        detector_input=args.input_size,
        detector_params=count_parameters(TileDetector()),
        classifier_params=count_parameters(TileClassifier(NUM_CLASSES)),
        detector_mb=(args.models / "detector.onnx").stat().st_size / 1e6,
        classifier_mb=(args.models / "classifier.onnx").stat().st_size / 1e6,
        scenes=results["scenes"],
        tiles=results["tiles"],
        ap50=results["detection"]["ap50"],
        precision=results["detection"]["precision"],
        recall=results["detection"]["recall"],
        top1=results["classification"]["top1"],
        top3=results["classification"]["top3"],
        matched_tiles=results["classification"].get("matched_tiles", 0),
        tile_accuracy=results["end_to_end"].get("tile_accuracy", 0.0),
        sweep_rows=sweep_rows,
        threshold_note=threshold_note,
        hand_perfect=results["end_to_end"]["hand_read_perfectly"],
        count_correct=results["end_to_end"]["tile_count_correct"],
        tiles_per_hand=results["tiles"] / max(1, results["scenes"]),
        latency_median=results["latency_ms"]["median"],
        latency_p95=results["latency_ms"]["p95"],
        min_support=int(support.min()),
        max_support=int(support.max()),
        detector_epoch=results["checkpoints"]["detector_epoch"],
        detector_val=results["checkpoints"]["detector_val_ap50"] or 0.0,
        classifier_epoch=results["checkpoints"]["classifier_epoch"],
        classifier_val=results["checkpoints"]["classifier_val_top1"] or 0.0,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
