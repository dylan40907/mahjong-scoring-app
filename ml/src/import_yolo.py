"""Import a third-party YOLO dataset of real tile photographs.

Written for Jon Chan's CC BY 4.0 mahjong dataset on Roboflow Universe, which is
the only public set found whose taxonomy matches this project's: 42 classes
including four flowers and four seasons. Most public mahjong datasets are
34-class Riichi sets, which omit precisely the bonus tiles the Taiwanese and
Hong Kong rulesets need.

    https://universe.roboflow.com/jon-chan-gnsoa/mahjong-baq4s

Two things about that export matter enough to be defaults here.

**Only valid and test are clean.** Roboflow augments the training split only -
three outputs per source image, including a *vertical* flip. A vertically
flipped tile face is not a tile face, and training a classifier on one teaches
a false invariance, which is exactly why data.py uses horizontal flip for the
detector and refuses it for the classifier. So `--splits valid test` is the
default: 1,356 un-augmented photographs.

**The boxes are human-drawn.** Unlike ingest_photos.py, whose boxes come from
our own detector and are therefore circular, these are independent annotations.
This is the only source in the project that can honestly measure detection AP
on real photographs.

The class mapping is the risk. Their names encode suit as a letter - B bamboo,
C characters, D dots - which is unambiguous. The flower and season *numbering*
is not: `1F` through `4F` is assumed to follow the conventional 梅蘭菊竹 order
and `1S` through `4S` the conventional 春夏秋冬, matching tileset.py. That
assumption is checked by eye, not by faith: `--contact-sheet` renders real crops
grouped under the label this mapping assigns them. Look at it before training
anything. Getting it wrong silently corrupts eight classes.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from tileset import BY_CODE, NUM_CLASSES  # noqa: E402

MAX_SOURCE_WIDTH = 1280

# Their class name -> our tile code. Suits are unambiguous; the eight entries
# marked below are conventional-order assumptions and are what --contact-sheet
# exists to verify.
CLASS_MAP: dict[str, str] = {
    # --- Jon Chan's naming: suit letter after the rank -------------------
    **{f"{rank}B": f"sou{rank}" for rank in range(1, 10)},   # Bamboo
    **{f"{rank}C": f"man{rank}" for rank in range(1, 10)},   # Characters
    **{f"{rank}D": f"pin{rank}" for rank in range(1, 10)},   # Dots
    "EW": "east", "SW": "south", "WW": "west", "NW": "north",
    "RD": "red", "GD": "green", "WD": "white",
    # Assumed orderings - verify with --contact-sheet before trusting.
    "1F": "flower_plum", "2F": "flower_orchid",
    "3F": "flower_chrysanthemum", "4F": "flower_bamboo",
    "1S": "season_spring", "2S": "season_summer",
    "3S": "season_autumn", "4S": "season_winter",

    # --- Spelled-out naming (Roman Nguyen and similar) -------------------
    **{f"bamboo_{rank}": f"sou{rank}" for rank in range(1, 10)},
    **{f"character_{rank}": f"man{rank}" for rank in range(1, 10)},
    **{f"circle_{rank}": f"pin{rank}" for rank in range(1, 10)},
    # east/south/west/north and red/green/white already match our codes.
    **{code: code for code in
       ("east", "south", "west", "north", "red", "green", "white")},

    # --- Riichi shorthand: 1m/1p/1s suits, 1z-7z honours -----------------
    # The honour order here is the standard one - E, S, W, N, haku, hatsu,
    # chun - which is NOT our dragon order (red, green, white). Getting it
    # backwards silently swaps two dragons, so --contact-sheet covers it.
    **{f"{rank}m": f"man{rank}" for rank in range(1, 10)},
    **{f"{rank}p": f"pin{rank}" for rank in range(1, 10)},
    **{f"{rank}s": f"sou{rank}" for rank in range(1, 10)},
    "1z": "east", "2z": "south", "3z": "west", "4z": "north",
    "5z": "white", "6z": "green", "7z": "red",

    # --- Prefix-first variant of the same scheme (m1/p1/s1/z1), plus f1-f8
    # --- for the bonus tiles that Riichi sets do not have.
    **{f"m{rank}": f"man{rank}" for rank in range(1, 10)},
    **{f"p{rank}": f"pin{rank}" for rank in range(1, 10)},
    **{f"s{rank}": f"sou{rank}" for rank in range(1, 10)},
    "z1": "east", "z2": "south", "z3": "west", "z4": "north",
    "z5": "white", "z6": "green", "z7": "red",
    # f1-f8 is assumed to be the four flowers then the four seasons, each in
    # conventional order. Two guesses stacked, so --contact-sheet matters more
    # here than anywhere else in this table.
    "f1": "flower_plum", "f2": "flower_orchid",
    "f3": "flower_chrysanthemum", "f4": "flower_bamboo",
    "f5": "season_spring", "f6": "season_summer",
    "f7": "season_autumn", "f8": "season_winter",
}

UNVERIFIED = {"1F", "2F", "3F", "4F", "1S", "2S", "3S", "4S",
              "5z", "6z", "7z", "z5", "z6", "z7",
              "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"}


def read_class_names(root: Path) -> list[str]:
    """Pull `names` out of data.yaml without taking a YAML dependency.

    Roboflow writes either `names: ['a', 'b']` on one line or a block list.
    Both are handled; anything else is a hard error rather than a guess.
    """
    text = (root / "data.yaml").read_text(encoding="utf-8")

    inline = []
    block = []
    in_block = False
    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if stripped.startswith("names:"):
            remainder = stripped[len("names:"):].strip()
            if remainder.startswith("["):
                inline = [
                    part.strip().strip("'\"")
                    for part in remainder.strip("[]").split(",")
                    if part.strip()
                ]
            else:
                in_block = True
            continue
        if in_block:
            if stripped.startswith("-"):
                block.append(stripped[1:].strip().strip("'\""))
            elif stripped and not line.startswith((" ", "\t")):
                in_block = False

    names = inline or block
    if not names:
        raise SystemExit(f"Could not parse `names` from {root / 'data.yaml'}")
    return names


def split_dirs(root: Path, split: str) -> tuple[Path, Path] | None:
    """The split's image and label directories, or None if it does not exist.

    Not every export carries every split - Roboflow omits `test` entirely when
    a version was generated without one. That is a fact about the dataset, not
    an error, so callers skip rather than abort: dying here would throw away a
    successfully imported `valid` because `test` happened to be absent.
    """
    images = root / split / "images"
    labels = root / split / "labels"
    if not images.is_dir() or not labels.is_dir():
        return None
    return images, labels


def convert_split(
    root: Path,
    split: str,
    names: list[str],
    out_dir: Path,
    max_width: int,
    samples: dict[int, list[np.ndarray]] | None,
    samples_per_class: int,
    max_box_fraction: float,
    min_aspect: float,
    max_aspect: float,
) -> tuple[list[dict], dict[str, int]]:
    located = split_dirs(root, split)
    if located is None:
        return [], {f"split {split!r} is not in this export": 1}
    images_dir, labels_dir = located
    out_images = out_dir / "images"
    out_images.mkdir(parents=True, exist_ok=True)

    records: list[dict] = []
    skipped: dict[str, int] = {}

    for image_path in sorted(images_dir.iterdir()):
        if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        label_path = labels_dir / f"{image_path.stem}.txt"
        if not label_path.exists():
            skipped["no label file"] = skipped.get("no label file", 0) + 1
            continue

        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            skipped["undecodable"] = skipped.get("undecodable", 0) + 1
            continue

        if image.shape[1] > max_width:
            scale = max_width / image.shape[1]
            image = cv2.resize(
                image, (max_width, int(round(image.shape[0] * scale))),
                interpolation=cv2.INTER_AREA,
            )
        height, width = image.shape[:2]

        boxes: list[list[float]] = []
        labels: list[int] = []
        for line in label_path.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            class_index = int(parts[0])
            cx, cy, bw, bh = (float(value) for value in parts[1:5])

            their_name = names[class_index]
            our_code = CLASS_MAP.get(their_name)
            if our_code is None:
                skipped[f"unmapped class {their_name}"] = (
                    skipped.get(f"unmapped class {their_name}", 0) + 1
                )
                continue

            # Sanity-check the annotation before trusting it. Public mahjong
            # datasets vary wildly in what a "box" means: some annotate each
            # tile, some draw one box round a whole pile and label it with a
            # single class. The second kind is poison - it teaches the detector
            # that a tile fills half the frame, and hands the classifier a crop
            # containing thirty tiles under one label. A tile is about 1% of a
            # photographed hand and has a 3:4 face, so both are checkable.
            if bw * bh > max_box_fraction:
                skipped["box too large to be one tile"] = (
                    skipped.get("box too large to be one tile", 0) + 1
                )
                continue
            aspect = (bh * height) / max(1e-6, bw * width)
            if not (min_aspect <= aspect <= max_aspect):
                skipped["implausible aspect for a tile"] = (
                    skipped.get("implausible aspect for a tile", 0) + 1
                )
                continue

            x0 = (cx - bw / 2) * width
            y0 = (cy - bh / 2) * height
            x1 = (cx + bw / 2) * width
            y1 = (cy + bh / 2) * height
            x0, y0 = max(0.0, x0), max(0.0, y0)
            x1, y1 = min(float(width), x1), min(float(height), y1)
            if x1 - x0 < 4 or y1 - y0 < 5:
                skipped["degenerate box"] = skipped.get("degenerate box", 0) + 1
                continue

            index = BY_CODE[our_code].index
            boxes.append([round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)])
            labels.append(index)

            if samples is not None and len(samples.setdefault(index, [])) < samples_per_class:
                crop = image[int(y0):int(y1), int(x0):int(x1)]
                if crop.size:
                    samples[index].append(cv2.resize(crop, (48, 64), interpolation=cv2.INTER_AREA))

        if not boxes:
            skipped["no usable boxes"] = skipped.get("no usable boxes", 0) + 1
            continue

        name = f"{split}_{image_path.stem}.jpg"
        cv2.imwrite(str(out_images / name), image, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        records.append({
            "image": name,
            "width": width,
            "height": height,
            "boxes": boxes,
            "labels": labels,
            "source": f"{split}/{image_path.name}",
            "box_source": "human",
        })

    # Writing is the caller's job: with --merge several splits share one
    # directory, and writing here would let each split clobber the last.
    return records, skipped


def write_contact_sheet(samples: dict[int, list[np.ndarray]], path: Path, per_class: int) -> None:
    """One row per class, real crops beside the label this mapping assigned.

    The flower and season rows are the ones to look at. If `flower_plum` shows
    an orchid, the mapping is wrong and eight classes are quietly corrupted.
    """
    from tileset import TILES

    cell_w, cell_h, label_w, pad = 48, 64, 190, 6
    rows = NUM_CLASSES
    width = label_w + per_class * (cell_w + pad) + pad
    height = rows * (cell_h + pad) + pad
    sheet = np.full((height, width, 3), 245, np.uint8)

    for tile in TILES:
        y = pad + tile.index * (cell_h + pad)
        highlight = tile.is_bonus
        if highlight:
            cv2.rectangle(sheet, (2, y - 3), (width - 3, y + cell_h + 2), (180, 210, 255), -1)
        cv2.putText(
            sheet, f"{tile.index:>2} {tile.code}", (6, y + cell_h // 2 + 4),
            cv2.FONT_HERSHEY_SIMPLEX, 0.42, (20, 20, 20), 1, cv2.LINE_AA,
        )
        for i, crop in enumerate(samples.get(tile.index, [])[:per_class]):
            x = label_w + i * (cell_w + pad)
            sheet[y:y + cell_h, x:x + cell_w] = crop

    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), sheet)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--root", type=Path, required=True,
                        help="Unzipped Roboflow YOLOv8 export (contains data.yaml)")
    parser.add_argument("--out", type=Path, required=True, help="Dataset directory to write")
    parser.add_argument("--splits", nargs="+", default=["valid", "test"],
                        help="Which splits to import. Default skips the augmented train split.")
    parser.add_argument("--merge", action="store_true",
                        help="Write one combined dataset instead of one per split")
    parser.add_argument("--contact-sheet", type=Path, default=None,
                        help="Write a per-class verification sheet here")
    parser.add_argument("--samples-per-class", type=int, default=8)
    parser.add_argument(
        "--max-box-fraction", type=float, default=0.06,
        help="Reject boxes covering more than this fraction of the image. A tile is "
             "around 1%% of a photographed hand; anything much larger is a pile "
             "annotated as one object.",
    )
    parser.add_argument(
        "--min-aspect", type=float, default=0.55,
        help="Minimum box height/width. An upright tile face is 1.33, but the "
             "axis-aligned hull of a tilted one tends toward square and a "
             "foreshortened one goes wider still - real datasets sit around 0.97 "
             "median. Set loosely on purpose: the size gate catches the pile "
             "annotations, and trimming hard here would discard exactly the "
             "steeply-viewed tiles worth training on.",
    )
    parser.add_argument("--max-aspect", type=float, default=2.6)
    parser.add_argument("--max-width", type=int, default=MAX_SOURCE_WIDTH)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    random.seed(args.seed)
    names = read_class_names(args.root)
    print(f"{len(names)} classes in data.yaml: {', '.join(names)}")

    unmapped = [name for name in names if name not in CLASS_MAP]
    if unmapped:
        print(f"\nWARNING: no mapping for {unmapped} - those boxes will be dropped.")

    samples: dict[int, list[np.ndarray]] | None = {} if args.contact_sheet else None

    merged: list[dict] = []
    for split in args.splits:
        out_dir = args.out if args.merge else args.out / split
        records, skipped = convert_split(
            args.root, split, names, out_dir, args.max_width, samples,
            args.samples_per_class, args.max_box_fraction, args.min_aspect, args.max_aspect,
        )
        tiles = sum(len(record["labels"]) for record in records)
        print(f"\n{split}: {len(records)} images, {tiles} tiles -> {out_dir}")
        for reason, count in sorted(skipped.items(), key=lambda kv: -kv[1]):
            print(f"  skipped {count}: {reason}")

        if args.merge:
            merged.extend(records)
        else:
            (out_dir / "annotations.json").write_text(json.dumps(records), encoding="utf-8")

    if args.merge:
        (args.out / "annotations.json").write_text(json.dumps(merged), encoding="utf-8")

    total_scenes = len(merged) if args.merge else None
    if args.merge:
        print(f"\nTotal: {total_scenes} images, "
              f"{sum(len(r['labels']) for r in merged)} tiles -> {args.out}")

    if args.contact_sheet and samples is not None:
        write_contact_sheet(samples, args.contact_sheet, args.samples_per_class)
        print(f"\nVerification sheet -> {args.contact_sheet}")
        print("Check the highlighted flower and season rows before training:")
        print(f"  {', '.join(sorted(UNVERIFIED))} are conventional-order assumptions.")


if __name__ == "__main__":
    main()
