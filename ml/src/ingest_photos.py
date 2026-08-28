"""Turn a folder of real photographs into a labelled dataset.

Hand-drawing five thousand boxes is the reason "photograph a real set" stays on
the to-do list forever. This removes almost all of it by exploiting one fact:
if you already know *which* tiles are in the photograph and in what order, the
only thing missing is their positions - and the existing detector is good
enough at positions to propose them. The human is left checking a picture
rather than drawing on one.

Two ways to supply the known contents:

  --sequence face-sheet     every photo shows the same layout, so one sequence
                            covers all of them. `face-sheet` is the frozen
                            class order from tileset.py, matching the layout
                            printed by make_face_sheet.py.
  --labels labels.txt       one line per photo, `filename: code,code,...`,
                            for hands that differ from shot to shot.

The count gate is what makes this safe. Labels are assigned by zipping the
known sequence against the detections in reading order, so a photo where the
detector found the wrong number of tiles would shift every later label by one.
Those photos are refused outright and listed in `rejected.json` rather than
being quietly mislabelled.

What this output is and is not valid for
----------------------------------------
The boxes come from the detector, so they are NOT independent ground truth for
detection. Measuring recall against them scores the detector against its own
opinion and returns approximately 1.0 however bad it is. This output is valid
for classifier evaluation and fine-tuning - those labels are genuinely
independent, since they come from the physical layout you arranged - and for
detector fine-tuning, where slightly loose boxes are a tolerable training
signal. It is not valid for reporting detection AP. For that, correct the
boxes by hand in a labelling tool first.

The review renders keep this honest: every photo is written out with its boxes
and assigned labels drawn on, and the classifier's own guess beside them. Flick
through, delete the bad ones, then re-run with --accept-from to prune the
annotations to what survived.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from evaluate import SCORE_THRESHOLD, load_models, run_pipeline  # noqa: E402
from tileset import BY_CODE, BY_INDEX, CODES  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

# The app decodes at this width before it does anything else (MAX_SOURCE_WIDTH
# in mobile/src/vision/detector.ts). Ingesting at the same size means the crops
# the classifier trains on are the size a phone will actually hand it.
MAX_SOURCE_WIDTH = 1280

TRUTH_COLOUR = (120, 200, 250)   # BGR amber: the label we assigned
AGREE_COLOUR = (110, 220, 130)   # green: the classifier said the same
DISAGREE_COLOUR = (80, 90, 235)  # red: it did not


# --------------------------------------------------------------------------
# Reading order
# --------------------------------------------------------------------------
#
# This mirrors mobile/src/vision/ordering.ts, which stays the authority for
# what the app does; this copy exists only to assign labels during ingestion
# and is deliberately the short version - no meld grouping, no hand/meld split.
# The rotation estimate is the part that matters and is reproduced exactly: a
# row of tiles photographed off-square climbs further vertically than a tile is
# tall, so a plain y-then-x sort interleaves rows and every label lands on the
# wrong tile.

def estimate_rotation(centres: np.ndarray) -> float:
    """Dominant row direction in radians, from nearest-neighbour vectors."""
    if len(centres) < 3:
        return 0.0

    angles = []
    for i, centre in enumerate(centres):
        deltas = centres - centre
        distances = (deltas ** 2).sum(axis=1)
        distances[i] = np.inf
        nearest = int(np.argmin(distances))
        dx, dy = centres[nearest] - centre
        # Fold direction so a neighbour to the left votes with one to the right
        # rather than cancelling it.
        if dx < 0:
            dx, dy = -dx, -dy
        angles.append(float(np.arctan2(dy, dx)))

    angle = float(np.median(angles))
    # A row is horizontal by construction; past 40 degrees this is a misread,
    # not a genuinely diagonal hand.
    return 0.0 if abs(angle) > np.radians(40) else angle


def reading_order(boxes: np.ndarray, row_tolerance: float = 0.6) -> tuple[np.ndarray, float]:
    """Indices of `boxes` in reading order, plus the measured rotation."""
    if len(boxes) == 0:
        return np.zeros(0, np.int64), 0.0

    centres = np.stack(
        [(boxes[:, 0] + boxes[:, 2]) / 2, (boxes[:, 1] + boxes[:, 3]) / 2], axis=1
    )
    rotation = estimate_rotation(centres)
    cos, sin = np.cos(-rotation), np.sin(-rotation)
    flat = np.stack(
        [centres[:, 0] * cos - centres[:, 1] * sin, centres[:, 0] * sin + centres[:, 1] * cos],
        axis=1,
    )

    tile_height = float(np.median(boxes[:, 3] - boxes[:, 1])) or 1.0

    # Sweep down the rotated frame, starting a new row whenever a tile sits
    # more than a fraction of a tile height below the running mean.
    rows: list[list[int]] = []
    current: list[int] = []
    mean_y = 0.0
    for raw_index in np.argsort(flat[:, 1]):
        index = int(raw_index)
        if current and abs(flat[index, 1] - mean_y) > tile_height * row_tolerance:
            rows.append(current)
            current = []
        current.append(index)
        mean_y = float(np.mean(flat[current, 1]))
    if current:
        rows.append(current)

    order: list[int] = []
    for row in rows:
        order.extend(sorted(row, key=lambda i: float(flat[i, 0])))
    return np.array(order, np.int64), float(np.degrees(rotation))


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------

def parse_sequence(value: str) -> list[str]:
    if value.strip() == "face-sheet":
        return list(CODES)
    codes = [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]
    unknown = [code for code in codes if code not in BY_CODE]
    if unknown:
        raise SystemExit(f"Unknown tile codes: {', '.join(unknown)}")
    return codes


def parse_label_file(path: Path) -> dict[str, list[str]]:
    """`filename: code,code,...` per line. Blank lines and # comments ignored."""
    mapping: dict[str, list[str]] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise SystemExit(f"{path}:{number}: expected 'filename: codes', got {line!r}")
        name, codes = line.split(":", 1)
        mapping[name.strip()] = parse_sequence(codes)
    return mapping


def load_photo(path: Path, max_width: int) -> np.ndarray:
    """Read as RGB, honouring EXIF rotation, downscaled to the app's width."""
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"could not decode {path.name}")
    if image.shape[1] > max_width:
        scale = max_width / image.shape[1]
        image = cv2.resize(
            image,
            (max_width, int(round(image.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


# --------------------------------------------------------------------------
# Review renders
# --------------------------------------------------------------------------

def draw_review(
    image: np.ndarray,
    boxes: np.ndarray,
    assigned: list[str] | None,
    predicted: np.ndarray,
    note: str,
) -> np.ndarray:
    canvas = cv2.cvtColor(image, cv2.COLOR_RGB2BGR).copy()

    for i, box in enumerate(boxes):
        x0, y0, x1, y1 = box.astype(int)
        guess = BY_INDEX[int(predicted[i])].code if len(predicted) > i else "?"

        if assigned is None:
            colour = TRUTH_COLOUR
            text = guess
        elif guess == assigned[i]:
            colour = AGREE_COLOUR
            text = assigned[i]
        else:
            colour = DISAGREE_COLOUR
            text = f"{assigned[i]}/{guess}"

        cv2.rectangle(canvas, (x0, y0), (x1, y1), colour, 2)
        cv2.putText(
            canvas, text, (x0, max(11, y0 - 4)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.36, colour, 1, cv2.LINE_AA,
        )

    cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 26), (24, 24, 24), -1)
    cv2.putText(
        canvas, note, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1, cv2.LINE_AA
    )
    return canvas


# --------------------------------------------------------------------------
# Ingestion
# --------------------------------------------------------------------------

def ingest(args: argparse.Namespace) -> None:
    photos = sorted(
        path for path in args.images.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )
    if not photos:
        raise SystemExit(f"No images found in {args.images}")

    sequence = parse_sequence(args.sequence) if args.sequence else None
    per_photo = parse_label_file(args.labels) if args.labels else None
    if sequence is None and per_photo is None and args.expect is None:
        raise SystemExit("Supply one of --sequence, --labels or --expect")

    # --accept-from prunes to the review renders that survived a human pass, so
    # rejecting a photo is deleting a file rather than editing JSON.
    accepted: set[str] | None = None
    if args.accept_from:
        accepted = {path.stem for path in args.accept_from.iterdir() if path.is_file()}
        print(f"Accepting only the {len(accepted)} photos still in {args.accept_from}")

    detector, classifier, _detector_state, _classifier_state = load_models(
        args.runs, args.input_size, args.width
    )

    image_dir = args.out / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    if args.review:
        args.review.mkdir(parents=True, exist_ok=True)

    records: list[dict] = []
    rejected: list[dict] = []
    agreements = disagreements = 0

    for photo in photos:
        if accepted is not None and photo.stem not in accepted:
            continue

        try:
            image = load_photo(photo, args.max_width)
        except ValueError as error:
            rejected.append({"image": photo.name, "reason": str(error)})
            continue

        boxes, scores, predicted, _top3 = run_pipeline(
            detector, classifier, image, args.input_size, args.min_score
        )

        expected_codes: list[str] | None = None
        if per_photo is not None:
            expected_codes = per_photo.get(photo.name)
            if expected_codes is None:
                rejected.append({"image": photo.name, "reason": "no line in --labels"})
                continue
        elif sequence is not None:
            expected_codes = sequence

        expected_count = len(expected_codes) if expected_codes is not None else args.expect

        order, rotation = reading_order(boxes)
        boxes = boxes[order]
        if len(predicted):
            predicted = predicted[order]

        # The count gate. Zipping a known sequence against the wrong number of
        # boxes shifts every label after the error, which is worse than no
        # label at all because it still looks fine in aggregate.
        if expected_count is not None and len(boxes) != expected_count:
            reason = f"found {len(boxes)} tiles, expected {expected_count}"
            rejected.append({"image": photo.name, "reason": reason})
            if args.review:
                cv2.imwrite(
                    str(args.review / f"REJECTED_{photo.stem}.jpg"),
                    draw_review(image, boxes, None, predicted,
                                f"{photo.name}  REJECTED - {reason}"),
                )
            continue

        assigned = list(expected_codes) if expected_codes is not None else None

        if assigned is not None:
            agree = sum(
                1 for i, code in enumerate(assigned)
                if BY_INDEX[int(predicted[i])].code == code
            )
            agreements += agree
            disagreements += len(assigned) - agree

            height, width = image.shape[:2]
            cv2.imwrite(
                str(image_dir / f"{photo.stem}.jpg"),
                cv2.cvtColor(image, cv2.COLOR_RGB2BGR),
                [int(cv2.IMWRITE_JPEG_QUALITY), 95],
            )
            records.append({
                "image": f"{photo.stem}.jpg",
                "width": width,
                "height": height,
                "boxes": np.asarray(boxes, np.float32).round(2).tolist(),
                "labels": [BY_CODE[code].index for code in assigned],
                "source": photo.name,
                "box_source": "detector",
            })

        if args.review:
            note = f"{photo.name}  {len(boxes)} tiles  rot {rotation:+.1f} deg"
            cv2.imwrite(
                str(args.review / f"{photo.stem}.jpg"),
                draw_review(image, boxes, assigned, predicted, note),
            )

    (args.out / "annotations.json").write_text(json.dumps(records), encoding="utf-8")
    if rejected:
        (args.out / "rejected.json").write_text(json.dumps(rejected, indent=2), encoding="utf-8")

    tiles = sum(len(record["labels"]) for record in records)
    print(f"\nAccepted {len(records)} photos, {tiles} tiles -> {args.out}")
    if rejected:
        print(f"Rejected {len(rejected)} - see {args.out / 'rejected.json'}")
        for entry in rejected[:10]:
            print(f"  {entry['image']}: {entry['reason']}")

    # Not a benchmark: the count gate has already dropped the photos the
    # detector struggled with, which are also the hard ones for the classifier.
    # But it is the first real-world signal this project has ever had.
    if agreements + disagreements:
        total = agreements + disagreements
        print(
            f"\nClassifier agreed with the known layout on {agreements}/{total} "
            f"tiles ({agreements / total:.1%}) across accepted photos."
        )
        print("Indicative only - the count gate drops the hard scenes.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--images", type=Path, required=True, help="Folder of photographs")
    parser.add_argument("--out", type=Path, required=True, help="Dataset directory to write")
    parser.add_argument("--sequence", type=str, default=None,
                        help="'face-sheet', or a comma-separated list of tile codes")
    parser.add_argument("--labels", type=Path, default=None,
                        help="File of 'filename: code,code,...' lines")
    parser.add_argument("--expect", type=int, default=None,
                        help="Expected tile count when the labels are not known")
    parser.add_argument("--review", type=Path, default=None, help="Where to write review renders")
    parser.add_argument("--accept-from", type=Path, default=None,
                        help="Keep only photos whose review render still exists here")
    parser.add_argument("--runs", type=Path, default=Path("runs"))
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--min-score", type=float, default=SCORE_THRESHOLD)
    parser.add_argument("--max-width", type=int, default=MAX_SOURCE_WIDTH)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()

    torch.set_num_threads(args.threads)
    ingest(args)


if __name__ == "__main__":
    main()
