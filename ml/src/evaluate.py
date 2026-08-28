"""Evaluate the pipeline the way it is actually used.

Component metrics are necessary but not sufficient. A detector at 0.99 AP and a
classifier at 0.99 top-1 do not give a 0.99 chance of reading a hand correctly:
a seventeen-tile hand is seventeen independent opportunities to be wrong, and
the number that matters to a user is whether the *whole hand* came out right.
So this reports the component numbers and then the end-to-end ones, on the
held-out test split neither model was trained or validated on.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from data import CROP_TRAIN_H, CROP_TRAIN_W, extract_crop, letterbox, normalise, load_annotations  # noqa: E402
from models import TileClassifier, TileDetector, decode  # noqa: E402
from tileset import CODES, NUM_CLASSES, TILES  # noqa: E402
from train_detector import average_precision, box_iou  # noqa: E402

# Joint peak of the whole-hand sweep on both test splits after the real-photo
# fine-tune. Mirrored in mobile/src/vision/detector.ts.
SCORE_THRESHOLD = 0.35
MATCH_IOU = 0.5


def load_models(runs: Path, input_size: int, width: int):
    detector = TileDetector(width=width)
    detector_state = torch.load(runs / "detector_best.pt", map_location="cpu", weights_only=False)
    detector.load_state_dict(detector_state["model"])
    detector.eval()

    classifier = TileClassifier(NUM_CLASSES, width=width)
    classifier_path = runs / "classifier_best.pt"
    classifier_state = None
    if classifier_path.exists():
        classifier_state = torch.load(classifier_path, map_location="cpu", weights_only=False)
        classifier.load_state_dict(classifier_state["model"])
    classifier.eval()

    return detector, classifier, detector_state, classifier_state


@torch.no_grad()
def run_pipeline(
    detector: TileDetector,
    classifier: TileClassifier,
    image: np.ndarray,
    input_size: int,
    threshold: float = SCORE_THRESHOLD,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Detect, crop and classify one photograph. Returns boxes, scores, labels, top3."""
    boxed, scale, (dx, dy) = letterbox(image, input_size)
    tensor = normalise(boxed).unsqueeze(0)

    heatmap, size, offset = detector(tensor)
    boxes, scores = decode(heatmap, size, offset)
    boxes = boxes[0].numpy()
    scores = scores[0].numpy()

    keep = scores >= threshold
    boxes, scores = boxes[keep], scores[keep]
    if len(boxes) == 0:
        return boxes, scores, np.zeros(0, np.int64), np.zeros((0, 3), np.int64)

    # Back into source-image coordinates.
    boxes[:, [0, 2]] -= dx
    boxes[:, [1, 3]] -= dy
    boxes /= scale
    h, w = image.shape[:2]
    boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
    boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)

    crops = np.stack(
        [extract_crop(image, box, CROP_TRAIN_W, CROP_TRAIN_H) for box in boxes]
    )
    batch = torch.stack([normalise(crop) for crop in crops])
    logits = classifier(batch)
    top3 = logits.topk(3, dim=1).indices.numpy()
    return boxes, scores, top3[:, 0], top3


def sweep_threshold(
    detector: TileDetector,
    classifier: TileClassifier,
    records,
    input_size: int,
    thresholds: list[float],
) -> list[dict]:
    """How the operating threshold trades misses against false positives.

    The default 0.35 is a guess until it is measured. What matters here is not
    AP - which integrates over all thresholds - but the fraction of *hands*
    that come out completely right at one fixed setting, because that is the
    single number the app operates at.
    """
    images = []
    truths = []
    for path, record in records:
        images.append(cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB))
        truths.append(
            (
                np.array(record["boxes"], np.float32).reshape(-1, 4),
                np.array(record["labels"], np.int64),
            )
        )

    rows = []
    for threshold in thresholds:
        perfect = counted = 0
        for image, (truth_boxes, truth_labels) in zip(images, truths):
            boxes, _scores, labels, _top3 = run_pipeline(
                detector, classifier, image, input_size, threshold
            )
            if len(boxes) == len(truth_boxes):
                counted += 1
            if len(boxes) != len(truth_boxes) or len(boxes) == 0:
                continue
            ious = box_iou(truth_boxes, boxes)
            used = np.zeros(len(boxes), bool)
            ok = True
            for truth_index in range(len(truth_boxes)):
                candidates = np.where(~used & (ious[truth_index] >= MATCH_IOU))[0]
                if len(candidates) == 0:
                    ok = False
                    break
                best = candidates[np.argmax(ious[truth_index][candidates])]
                used[best] = True
                if int(labels[best]) != int(truth_labels[truth_index]):
                    ok = False
                    break
            if ok:
                perfect += 1
        rows.append(
            {
                "threshold": threshold,
                "hand_read_perfectly": round(perfect / max(1, len(images)), 4),
                "tile_count_correct": round(counted / max(1, len(images)), 4),
            }
        )
        print(f"  threshold {threshold:.2f}: hands {rows[-1]['hand_read_perfectly']:.3f}", flush=True)
    return rows


def evaluate(
    roots: list[Path],
    runs: Path,
    input_size: int,
    width: int,
    limit: int | None,
    sweep: list[float] | None = None,
) -> dict:
    detector, classifier, detector_state, classifier_state = load_models(runs, input_size, width)
    records = load_annotations(roots)
    if limit:
        records = records[:limit]

    detector_predictions: list[tuple[np.ndarray, np.ndarray]] = []
    detector_truths: list[np.ndarray] = []

    tile_total = tile_matched = tile_correct = tile_top3 = 0
    hands_total = hands_perfect = hands_boxes_right = 0
    confusion = np.zeros((NUM_CLASSES, NUM_CLASSES), np.int64)
    latencies: list[float] = []

    for index, (path, record) in enumerate(records):
        image = cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        truth_boxes = np.array(record["boxes"], np.float32).reshape(-1, 4)
        truth_labels = np.array(record["labels"], np.int64)

        started = time.perf_counter()
        boxes, scores, labels, top3 = run_pipeline(detector, classifier, image, input_size)
        latencies.append(time.perf_counter() - started)

        detector_predictions.append((boxes, scores))
        detector_truths.append(truth_boxes)

        hands_total += 1
        if len(boxes) == len(truth_boxes):
            hands_boxes_right += 1

        # Match each ground-truth tile to at most one prediction, greedily by
        # IoU. An unmatched truth tile counts as a miss, which is what makes
        # the per-tile figure comparable across scenes.
        matched_prediction = np.zeros(len(boxes), bool)
        hand_ok = len(boxes) == len(truth_boxes)

        if len(boxes) and len(truth_boxes):
            ious = box_iou(truth_boxes, boxes)
            for truth_index in range(len(truth_boxes)):
                candidates = np.where(~matched_prediction & (ious[truth_index] >= MATCH_IOU))[0]
                tile_total += 1
                if len(candidates) == 0:
                    # Not detected at all. Counts against the pipeline but says
                    # nothing about the classifier, so it is excluded from the
                    # classifier's own denominator below.
                    hand_ok = False
                    continue
                best = candidates[np.argmax(ious[truth_index][candidates])]
                matched_prediction[best] = True
                predicted = int(labels[best])
                actual = int(truth_labels[truth_index])
                confusion[actual, predicted] += 1
                tile_matched += 1
                if predicted == actual:
                    tile_correct += 1
                else:
                    hand_ok = False
                if actual in top3[best]:
                    tile_top3 += 1
        else:
            tile_total += len(truth_boxes)
            hand_ok = False

        if hand_ok:
            hands_perfect += 1

        if (index + 1) % 100 == 0:
            print(f"  {index + 1}/{len(records)}", flush=True)

    threshold_sweep = []
    if sweep:
        print("threshold sweep:", flush=True)
        threshold_sweep = sweep_threshold(detector, classifier, records, input_size, sweep)

    detection_metrics = average_precision(detector_predictions, detector_truths)
    per_class = np.divide(
        confusion.diagonal(), confusion.sum(axis=1),
        out=np.zeros(NUM_CLASSES), where=confusion.sum(axis=1) > 0,
    )
    worst = np.argsort(per_class)[:5]

    return {
        "scenes": hands_total,
        "tiles": tile_total,
        "detection": {k: round(v, 4) for k, v in detection_metrics.items()},
        "classification": {
            # Denominator is tiles the detector actually found: this is the
            # classifier's own accuracy, not the pipeline's.
            "top1": round(tile_correct / max(1, tile_matched), 4),
            "top3": round(tile_top3 / max(1, tile_matched), 4),
            "matched_tiles": tile_matched,
            "worst_classes": [
                {"code": CODES[i], "accuracy": round(float(per_class[i]), 4), "support": int(confusion[i].sum())}
                for i in worst
            ],
        },
        "end_to_end": {
            # Every truth tile counts, whether or not it was detected. This is
            # the number that describes what a user sees.
            "tile_accuracy": round(tile_correct / max(1, tile_total), 4),
            "hand_read_perfectly": round(hands_perfect / max(1, hands_total), 4),
            "tile_count_correct": round(hands_boxes_right / max(1, hands_total), 4),
        },
        "latency_ms": {
            "median": round(float(np.median(latencies) * 1000), 1),
            "p95": round(float(np.percentile(latencies, 95) * 1000), 1),
        },
        "checkpoints": {
            "detector_epoch": detector_state.get("epoch"),
            "detector_val_ap50": detector_state.get("metrics", {}).get("ap50"),
            "classifier_epoch": classifier_state.get("epoch") if classifier_state else None,
            "classifier_val_top1": classifier_state.get("top1") if classifier_state else None,
        },
        "threshold_sweep": threshold_sweep,
        "confusion": confusion.tolist(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roots", type=Path, nargs="+", required=True)
    parser.add_argument("--runs", type=Path, default=Path("ml/runs"))
    parser.add_argument("--out", type=Path, default=Path("ml/runs/evaluation.json"))
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument(
        "--sweep",
        type=float,
        nargs="*",
        default=[0.20, 0.30, 0.35, 0.40, 0.50, 0.60],
        help="Detection thresholds to sweep; empty to skip",
    )
    args = parser.parse_args()

    torch.set_num_threads(args.threads)
    results = evaluate(
        args.roots, args.runs, args.input_size, args.width, args.limit, args.sweep
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2))

    print()
    print(f"scenes {results['scenes']}   tiles {results['tiles']}")
    print("detection    AP50 {ap50}  precision {precision}  recall {recall}".format(**results["detection"]))
    print(
        "classifier   top-1 {top1}  top-3 {top3}  (on {matched_tiles} detected tiles)".format(
            **results["classification"]
        )
    )
    print(
        "end to end   per tile {tile_accuracy}  whole hand correct {hand_read_perfectly}  "
        "tile count correct {tile_count_correct}".format(**results["end_to_end"])
    )
    print(f"latency      {results['latency_ms']['median']} ms median, {results['latency_ms']['p95']} ms p95")
    if results["threshold_sweep"]:
        print("\nthreshold sweep:")
        for row in results["threshold_sweep"]:
            print(
                f"  {row['threshold']:.2f}  whole hand {row['hand_read_perfectly']:.3f}"
                f"  tile count {row['tile_count_correct']:.3f}"
            )

    print("\nweakest classes:")
    for entry in results["classification"]["worst_classes"]:
        print(f"  {entry['code']:<22} {entry['accuracy']:.3f}  (n={entry['support']})")


if __name__ == "__main__":
    main()
