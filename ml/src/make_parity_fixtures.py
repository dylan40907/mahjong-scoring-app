"""Emit reference tensors so the app's preprocessing can be checked against
the training pipeline's.

Train/inference skew in preprocessing is the classic silent failure: the model
is fine, the code runs, and accuracy is mysteriously poor because the app
letterboxes or normalises a hair differently than training did. The Python and
TypeScript implementations are necessarily separate, so they are pinned to each
other with fixtures rather than to a shared description of what they should do.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from data import CROP_TRAIN_H, CROP_TRAIN_W, extract_crop, letterbox, normalise  # noqa: E402


def synthetic_image(width: int, height: int, seed: int) -> np.ndarray:
    """A deterministic image with structure at several scales.

    Flat colour would hide interpolation differences; noise alone would hide
    systematic offsets. Gradients plus a hard-edged block catch both.
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    image = np.zeros((height, width, 3), np.float32)
    image[..., 0] = 255 * xx / max(1, width - 1)
    image[..., 1] = 255 * yy / max(1, height - 1)
    image[..., 2] = 128 + 100 * np.sin(xx / 11.0) * np.cos(yy / 7.0)
    image[height // 4 : height // 2, width // 5 : width // 2] = [240, 30, 90]
    image += rng.normal(0, 6, image.shape)
    return np.clip(image, 0, 255).astype(np.uint8)


def main() -> None:
    out_path = Path(__file__).resolve().parents[2] / "mobile" / "src" / "vision" / "__tests__" / "parity.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cases = []

    for name, (w, h), size in (("landscape", (97, 61), 32), ("portrait", (48, 83), 32)):
        image = synthetic_image(w, h, seed=len(name))
        boxed, scale, (dx, dy) = letterbox(image, size)
        tensor = normalise(boxed).numpy()
        cases.append(
            {
                "name": f"letterbox_{name}",
                "kind": "letterbox",
                "width": w,
                "height": h,
                "size": size,
                "rgba": to_rgba(image),
                "scale": scale,
                "padX": dx,
                "padY": dy,
                "tensor": [round(float(v), 7) for v in tensor.reshape(-1)],
            }
        )

    image = synthetic_image(120, 90, seed=7)
    for name, box in (
        ("inside", [20.0, 15.0, 56.0, 63.0]),
        ("overhanging", [-8.0, 60.0, 28.0, 108.0]),
    ):
        crop = extract_crop(image, np.array(box, np.float32), CROP_TRAIN_W, CROP_TRAIN_H, pad=0.14)
        tensor = normalise(crop).numpy()
        cases.append(
            {
                "name": f"crop_{name}",
                "kind": "crop",
                "width": 120,
                "height": 90,
                "box": box,
                "outWidth": CROP_TRAIN_W,
                "outHeight": CROP_TRAIN_H,
                "rgba": to_rgba(image),
                "tensor": [round(float(v), 7) for v in tensor.reshape(-1)],
            }
        )

    out_path.write_text(json.dumps({"cases": cases}))
    total = sum(len(c["tensor"]) for c in cases)
    print(f"Wrote {len(cases)} parity cases ({total} reference values) -> {out_path}")


def to_rgba(image: np.ndarray) -> list[int]:
    h, w = image.shape[:2]
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = image
    rgba[..., 3] = 255
    return rgba.reshape(-1).tolist()


if __name__ == "__main__":
    main()
