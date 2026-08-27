"""Draw the pipeline's output on held-out scenes.

Metrics say how often it is right; a picture says what "wrong" looks like. A
detector at 0.99 AP that is systematically clipping the left edge of every tile
still reads 0.99, and only a look at the boxes shows it.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from data import load_annotations  # noqa: E402
from evaluate import SCORE_THRESHOLD, load_models, run_pipeline  # noqa: E402
from tileset import BY_INDEX  # noqa: E402

TRUTH_COLOUR = (90, 90, 90)      # BGR: grey, drawn underneath
HIT_COLOUR = (110, 220, 130)     # green
MISS_COLOUR = (80, 90, 235)      # red


def draw(image: np.ndarray, boxes, labels, truth_boxes, truth_labels, show_labels: bool) -> np.ndarray:
    canvas = cv2.cvtColor(image, cv2.COLOR_RGB2BGR).copy()

    for box in truth_boxes:
        x0, y0, x1, y1 = box.astype(int)
        cv2.rectangle(canvas, (x0, y0), (x1, y1), TRUTH_COLOUR, 1)

    # Match predictions to ground truth by centre distance so a correct label on
    # a slightly-off box still reads as a hit.
    truth_centres = np.stack(
        [(truth_boxes[:, 0] + truth_boxes[:, 2]) / 2, (truth_boxes[:, 1] + truth_boxes[:, 3]) / 2],
        axis=1,
    ) if len(truth_boxes) else np.zeros((0, 2))

    for index, box in enumerate(boxes):
        x0, y0, x1, y1 = box.astype(int)
        predicted = int(labels[index]) if len(labels) else -1

        colour = MISS_COLOUR
        if len(truth_centres):
            centre = np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
            nearest = int(np.argmin(((truth_centres - centre) ** 2).sum(axis=1)))
            if predicted == int(truth_labels[nearest]):
                colour = HIT_COLOUR

        cv2.rectangle(canvas, (x0, y0), (x1, y1), colour, 2)
        if show_labels and predicted >= 0:
            text = BY_INDEX[predicted].code
            cv2.putText(canvas, text, (x0, max(10, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, colour, 1)

    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--runs", type=Path, default=Path("ml/runs"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--count", type=int, default=6)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--labels", action="store_true", help="Draw predicted tile codes")
    args = parser.parse_args()

    torch.set_num_threads(2)
    detector, classifier, _, _ = load_models(args.runs, args.input_size, args.width)
    records = load_annotations([args.root])[args.offset : args.offset + args.count]

    panels = []
    for path, record in records:
        image = cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        boxes, scores, labels, _ = run_pipeline(detector, classifier, image, args.input_size)
        truth_boxes = np.array(record["boxes"], np.float32).reshape(-1, 4)
        truth_labels = np.array(record["labels"], np.int64)
        panel = draw(image, boxes, labels, truth_boxes, truth_labels, args.labels)
        cv2.putText(
            panel,
            f"found {len(boxes)} / {len(truth_boxes)}",
            (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 2,
        )
        panels.append(cv2.resize(panel, (480, 360)))

    cols = 3
    rows = [np.hstack(panels[i : i + cols]) for i in range(0, len(panels), cols)]
    widest = max(row.shape[1] for row in rows)
    rows = [
        np.pad(row, ((0, 0), (0, widest - row.shape[1]), (0, 0)), constant_values=20) for row in rows
    ]
    cv2.imwrite(str(args.out), np.vstack(rows))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
