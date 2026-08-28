"""Download, import and evaluate the public real-photo dataset in one step.

Jon Chan's mahjong dataset (CC BY 4.0) is the only public set found whose
taxonomy matches this project's 42 classes, flowers and seasons included, and
its images are photographs of physical tiles rather than game screenshots.
Downloading it needs a Roboflow API key.

Run it and paste the key at the hidden prompt; nothing else to set up:

    python src/fetch_public_dataset.py

`ROBOFLOW_API_KEY` in the environment is used instead when set, which is what
an unattended run wants. Passing it as a command-line argument is deliberately
not supported - arguments land in shell history, and this is an account
credential rather than a dataset-scoped one.

What this produces, in order:

  1. downloads/mahjong-83/            the raw Roboflow YOLOv8 export
  2. data/real/public_valid/ and _test/   converted to our schema, kept apart
  3. ../docs/images/public-classes.png   per-class verification sheet
  4. runs/evaluation-real.json        the first honest real-world numbers

Only the valid and test splits are imported. Roboflow augments the train split
three ways including a vertical flip, and a vertically flipped tile face is not
a tile face - the same reason data.py allows horizontal flip for the detector
and refuses it for the classifier.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parent

FORMAT = "yolov8"

# Public sources worth pulling, with their licence recorded here rather than in
# a comment somewhere else. `bonus` marks the ones that carry flowers and
# seasons: most public mahjong data is Riichi, which has none, so those sets
# broaden the 34 suit and honour classes but cannot help the other eight.
DATASETS: dict[str, dict] = {
    "jon-chan": {
        "workspace": "jon-chan-gnsoa",
        "project": "mahjong-baq4s",
        "version": 83,
        "licence": "CC BY 4.0",
        "classes": 42,
        "bonus": True,
        "note": "Physical sets on real tables; the only public 42-class set found.",
    },
    "riichi-6810": {
        "workspace": "project-xv49e",
        "project": "mahjong-x5dzz",
        "version": 2,
        "licence": "CC BY 4.0",
        "classes": 34,
        "bonus": False,
        "note": "6,810 photographs, one tight box per tile, Riichi 1m/1z naming.",
    },
    "merged-bonus": {
        "workspace": "test-ag8z6",
        "project": "mahjong-tiles-merged",
        "version": 1,
        "licence": "CC BY 4.0",
        "classes": 54,
        "bonus": True,
        "note": "1,744 photographs including flowers and seasons. 54 classes "
                "because two datasets were merged without deduplicating their "
                "class lists - m2 and 2man both appear - but every name maps.",
    },
}

# Checked and rejected, recorded so nobody pays to rediscover it:
#
#   roman-nguyen/mahjong-vtacs - boxes bound whole piles rather than tiles.
#     Median box covers 20% of the image against 0.8% for a real tile
#     annotation; only 74 of 4,673 boxes survive the import gate.
#   test-wmo8i/mahjong_yolo - 86 classes named by opaque integers with no key.
#   core-wlsb7/mahjong-soul - screenshots of a video game, not photographs.
#   test-ag8z6/mahjong-tiles-non-riichi - 905 images, 42 classes, and the best
#     match to the app's own framing, but no version was ever generated, so
#     there is nothing to download. Fork it on Roboflow and generate one if it
#     is ever worth the effort; mahjong-tiles-merged from the same owner
#     appears to contain it and is downloadable.


def read_key() -> str:
    """The API key, from the environment or a no-echo prompt.

    Never accepted as a command-line argument: arguments land in shell history,
    and this is an account credential rather than a dataset-scoped one. The
    prompt is the friendlier path - nothing to set up, nothing left behind.
    """
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if key:
        return key

    # Both streams, not just stdin: on Windows getpass reads the console
    # directly and ignores a redirected stdin, so a stdin-only check hangs
    # forever instead of failing when this runs unattended.
    if sys.stdin.isatty() and sys.stdout.isatty():
        print("Roboflow API key needed (input is hidden, and is not saved anywhere).")
        print("Find it at https://app.roboflow.com/settings/api\n")
        key = getpass.getpass("API key: ").strip()
        if key:
            return key

    raise SystemExit(
        "No API key given.\n\n"
        "Run this from an interactive terminal and paste the key at the prompt,\n"
        "or set it first:\n\n"
        "  PowerShell:  $env:ROBOFLOW_API_KEY = \"<your key>\"\n"
        "  bash:        export ROBOFLOW_API_KEY=\"<your key>\"\n\n"
        "Find it at https://app.roboflow.com/settings/api"
    )


def download(destination: Path, spec: dict) -> Path:
    if (destination / "data.yaml").exists():
        print(f"Already downloaded -> {destination}")
        return destination

    key = read_key()

    try:
        from roboflow import Roboflow
    except ImportError:
        raise SystemExit("pip install roboflow")

    print(f"Downloading {spec['workspace']}/{spec['project']} "
          f"v{spec['version']} as {FORMAT} ({spec['licence']})...")
    roboflow = Roboflow(api_key=key)
    project = roboflow.workspace(spec["workspace"]).project(spec["project"])

    # Version numbers are not stable across datasets and a wrong one fails only
    # after the key prompt and two network round trips. Ask the project what it
    # actually has, and fall back to its newest rather than guessing.
    wanted = spec.get("version")
    try:
        if wanted is None:
            raise RuntimeError("no version pinned")
        version = project.version(wanted)
    except RuntimeError:
        available = sorted(
            int(str(v.version).rsplit("/", 1)[-1]) for v in project.versions()
        )
        if not available:
            raise SystemExit(f"{spec['workspace']}/{spec['project']} has no versions.")
        newest = available[-1]
        print(f"Version {wanted} is gone; this project has {available}. Using {newest}.")
        version = project.version(newest)

    dataset = version.download(FORMAT, location=str(destination))
    return Path(dataset.location)


def run(command: list[str]) -> None:
    print(f"\n$ {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=ML_ROOT)
    if result.returncode != 0:
        raise SystemExit(f"Step failed with exit code {result.returncode}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dataset", choices=sorted(DATASETS), default="jon-chan",
                        help="Which public source to pull; see DATASETS.")
    parser.add_argument("--download-dir", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--runs", type=Path, default=ML_ROOT / "runs")
    parser.add_argument("--contact-sheet", type=Path,
                        default=None)
    parser.add_argument("--splits", nargs="+", default=["valid", "test"])
    parser.add_argument("--no-eval", action="store_true", help="Stop after importing")
    args = parser.parse_args()

    spec = DATASETS[args.dataset]
    download_dir = args.download_dir or ML_ROOT / "downloads" / args.dataset
    out_base = args.out or ML_ROOT / "data" / "real" / args.dataset

    if not spec["bonus"]:
        print(f"Note: {args.dataset} has {spec['classes']} classes and no flowers or "
              "seasons. It broadens the suits and honours; it cannot help the bonus tiles.")

    root = download(download_dir, spec)

    # One directory per split, never merged. Validation and test have to stay
    # separable or the best epoch gets chosen against the same photographs the
    # final number is reported on.
    total = 0
    for index, split in enumerate(args.splits):
        out = out_base.parent / f"{out_base.name}_{split}"
        command = [
            sys.executable, str(HERE / "import_yolo.py"),
            "--root", str(root),
            "--out", str(out),
            "--merge",
            "--splits", split,
        ]
        sheet = args.contact_sheet or (
            ML_ROOT.parent / "docs" / "images" / f"classes-{args.dataset}.png")
        if index == 0:
            command += ["--contact-sheet", str(sheet)]
        run(command)

        annotations = json.loads((out / "annotations.json").read_text(encoding="utf-8"))
        if not annotations:
            # Roboflow omits `test` entirely when a version was generated
            # without one. Absent is not broken.
            print(f"\n{split}: not present in this export; skipped.")
            continue
        tiles = sum(len(record["labels"]) for record in annotations)
        total += len(annotations)
        print(f"\n{split}: {len(annotations)} photographs, {tiles} tiles -> {out}")

    print(f"\nImported {total} real photographs.")

    if args.no_eval:
        print("\nStopping before evaluation as asked.")
        return

    print("\n" + "=" * 70)
    print("Evaluating the synthetic-trained models on real photographs.")
    print("These boxes are human-drawn, so unlike ingest_photos.py output the")
    print("detection numbers here are honest.")
    print("=" * 70)

    run([
        sys.executable, str(HERE / "evaluate.py"),
        "--roots", str(out_base.parent / f"{out_base.name}_test"),
        "--runs", str(args.runs),
        "--out", str(args.runs / "evaluation-real.json"),
    ])

    print(f"\nCheck {args.contact_sheet} before trusting the flower and season rows.")


if __name__ == "__main__":
    main()
