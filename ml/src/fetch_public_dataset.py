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

WORKSPACE = "jon-chan-gnsoa"
PROJECT = "mahjong-baq4s"
VERSION = 83
FORMAT = "yolov8"


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


def download(destination: Path) -> Path:
    if (destination / "data.yaml").exists():
        print(f"Already downloaded -> {destination}")
        return destination

    key = read_key()

    try:
        from roboflow import Roboflow
    except ImportError:
        raise SystemExit("pip install roboflow")

    print(f"Downloading {WORKSPACE}/{PROJECT} v{VERSION} as {FORMAT}...")
    roboflow = Roboflow(api_key=key)
    version = roboflow.workspace(WORKSPACE).project(PROJECT).version(VERSION)
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
    parser.add_argument("--download-dir", type=Path, default=ML_ROOT / "downloads" / "mahjong-83")
    parser.add_argument("--out", type=Path, default=ML_ROOT / "data" / "real" / "public")
    parser.add_argument("--runs", type=Path, default=ML_ROOT / "runs")
    parser.add_argument("--contact-sheet", type=Path,
                        default=ML_ROOT.parent / "docs" / "images" / "public-classes.png")
    parser.add_argument("--splits", nargs="+", default=["valid", "test"])
    parser.add_argument("--no-eval", action="store_true", help="Stop after importing")
    args = parser.parse_args()

    root = download(args.download_dir)

    # One directory per split, never merged. Validation and test have to stay
    # separable or the best epoch gets chosen against the same photographs the
    # final number is reported on.
    total = 0
    for index, split in enumerate(args.splits):
        out = args.out.parent / f"{args.out.name}_{split}"
        command = [
            sys.executable, str(HERE / "import_yolo.py"),
            "--root", str(root),
            "--out", str(out),
            "--merge",
            "--splits", split,
        ]
        if index == 0:
            command += ["--contact-sheet", str(args.contact_sheet)]
        run(command)

        annotations = json.loads((out / "annotations.json").read_text(encoding="utf-8"))
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
        "--roots", str(args.out.parent / f"{args.out.name}_test"),
        "--runs", str(args.runs),
        "--out", str(args.runs / "evaluation-real.json"),
    ])

    print(f"\nCheck {args.contact_sheet} before trusting the flower and season rows.")


if __name__ == "__main__":
    main()
