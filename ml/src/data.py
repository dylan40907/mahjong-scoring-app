"""Datasets feeding the two networks.

The detector consumes whole scenes letterboxed to a square, with CenterNet
targets splatted onto a stride-4 grid. The classifier consumes tile crops
lifted from those same scenes using the ground-truth boxes, which is the point:
at inference the classifier only ever sees crops produced by the detector, so
training it on crops produced the same way keeps the two stages in the same
distribution. Crops are deliberately jittered in position and scale to stand in
for the detector's localisation error.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

sys.path.insert(0, str(Path(__file__).parent))
from tileset import NUM_CLASSES  # noqa: E402

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], np.float32)


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def letterbox(
    image: np.ndarray,
    size: int,
    pad_value: int = 114,
) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Resize preserving aspect ratio and pad to a square.

    Users photograph a hand in whatever orientation is convenient, so the
    detector must accept any aspect ratio. Letterboxing keeps tiles
    geometrically undistorted - which matters because the fixed 3:4 tile
    aspect is a strong cue the network can otherwise not rely on.
    """
    h, w = image.shape[:2]
    scale = min(size / w, size / h)
    new_w, new_h = int(round(w * scale)), int(round(h * scale))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)

    canvas = np.full((size, size, 3), pad_value, np.uint8)
    dx, dy = (size - new_w) // 2, (size - new_h) // 2
    canvas[dy : dy + new_h, dx : dx + new_w] = resized
    return canvas, scale, (dx, dy)


def normalise(image: np.ndarray) -> torch.Tensor:
    """HWC uint8 RGB -> CHW float tensor, ImageNet-normalised."""
    x = image.astype(np.float32) / 255.0
    x = (x - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(x.transpose(2, 0, 1).copy())


def gaussian_radius(height: float, width: float, min_overlap: float = 0.7) -> float:
    """CenterNet's radius: how far a predicted centre may drift and still
    produce a box overlapping the truth by `min_overlap`."""
    a1 = 1.0
    b1 = height + width
    c1 = width * height * (1 - min_overlap) / (1 + min_overlap)
    sq1 = math.sqrt(max(0.0, b1 ** 2 - 4 * a1 * c1))
    r1 = (b1 - sq1) / (2 * a1)

    a2 = 4.0
    b2 = 2 * (height + width)
    c2 = (1 - min_overlap) * width * height
    sq2 = math.sqrt(max(0.0, b2 ** 2 - 4 * a2 * c2))
    r2 = (b2 - sq2) / (2 * a2)

    a3 = 4 * min_overlap
    b3 = -2 * min_overlap * (height + width)
    c3 = (min_overlap - 1) * width * height
    sq3 = math.sqrt(max(0.0, b3 ** 2 - 4 * a3 * c3))
    r3 = (b3 + sq3) / (2 * a3)

    return max(0.0, min(r1, r2, r3))


def splat_gaussian(heatmap: np.ndarray, cx: int, cy: int, radius: int) -> None:
    """Add a 2D Gaussian to the heatmap, keeping the per-cell maximum."""
    diameter = 2 * radius + 1
    sigma = diameter / 6.0
    ax = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(ax[:, None] ** 2 + ax[None, :] ** 2) / (2 * sigma ** 2))
    kernel[kernel < np.finfo(np.float32).eps * kernel.max()] = 0

    h, w = heatmap.shape
    left, right = min(cx, radius), min(w - cx, radius + 1)
    top, bottom = min(cy, radius), min(h - cy, radius + 1)
    if right <= -left or bottom <= -top:
        return

    region = heatmap[cy - top : cy + bottom, cx - left : cx + right]
    patch = kernel[radius - top : radius + bottom, radius - left : radius + right]
    np.maximum(region, patch, out=region)


def load_annotations(roots: list[Path]) -> list[tuple[Path, dict]]:
    records: list[tuple[Path, dict]] = []
    for root in roots:
        payload = json.loads((root / "annotations.json").read_text())
        for record in payload:
            records.append((root / "images" / record["image"], record))
    return records


# --------------------------------------------------------------------------
# Detector dataset
# --------------------------------------------------------------------------

class SceneDataset(Dataset):
    """Whole scenes with CenterNet targets on a stride-4 grid."""

    def __init__(
        self,
        roots: list[Path],
        input_size: int = 320,
        stride: int = 4,
        max_objects: int = 40,
        train: bool = True,
    ):
        self.records = load_annotations(roots)
        self.input_size = input_size
        self.stride = stride
        self.grid = input_size // stride
        self.max_objects = max_objects
        self.train = train

    def __len__(self) -> int:
        return len(self.records)

    def _augment(self, image: np.ndarray, boxes: np.ndarray, rng: np.random.Generator):
        # Horizontal flip is safe for the detector because it is class-blind.
        # It is deliberately NOT used for the classifier: a mirrored tile face
        # is not a tile face, and training on one teaches a false invariance.
        if rng.random() < 0.5:
            image = image[:, ::-1]
            w = image.shape[1]
            boxes = boxes.copy()
            boxes[:, [0, 2]] = w - boxes[:, [2, 0]]

        if rng.random() < 0.7:
            image = np.clip(
                image.astype(np.float32) * rng.uniform(0.82, 1.18) + rng.uniform(-18, 18), 0, 255
            ).astype(np.uint8)

        return np.ascontiguousarray(image), boxes

    def __getitem__(self, index: int):
        path, record = self.records[index]
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        boxes = np.array(record["boxes"], np.float32).reshape(-1, 4)

        if self.train:
            image, boxes = self._augment(image, boxes, np.random.default_rng())

        image, scale, (dx, dy) = letterbox(image, self.input_size)
        boxes = boxes * scale
        boxes[:, [0, 2]] += dx
        boxes[:, [1, 3]] += dy

        g = self.grid
        heatmap = np.zeros((1, g, g), np.float32)
        size_target = np.zeros((2, g, g), np.float32)
        offset_target = np.zeros((2, g, g), np.float32)
        mask = np.zeros((g, g), np.float32)

        for x0, y0, x1, y1 in boxes:
            bw, bh = x1 - x0, y1 - y0
            if bw <= 1 or bh <= 1:
                continue
            cx, cy = (x0 + x1) / 2 / self.stride, (y0 + y1) / 2 / self.stride
            ix, iy = int(cx), int(cy)
            if not (0 <= ix < g and 0 <= iy < g):
                continue

            radius = max(1, int(gaussian_radius(bh / self.stride, bw / self.stride)))
            splat_gaussian(heatmap[0], ix, iy, radius)
            size_target[0, iy, ix] = bw
            size_target[1, iy, ix] = bh
            offset_target[0, iy, ix] = cx - ix
            offset_target[1, iy, ix] = cy - iy
            mask[iy, ix] = 1.0

        return {
            "image": normalise(image),
            "heatmap": torch.from_numpy(heatmap),
            "size": torch.from_numpy(size_target),
            "offset": torch.from_numpy(offset_target),
            "mask": torch.from_numpy(mask),
            "boxes": torch.from_numpy(boxes),
        }


def collate_scenes(batch: list[dict]) -> dict:
    out = {
        key: torch.stack([item[key] for item in batch])
        for key in ("image", "heatmap", "size", "offset", "mask")
    }
    out["boxes"] = [item["boxes"] for item in batch]
    return out


# --------------------------------------------------------------------------
# Classifier crops
# --------------------------------------------------------------------------

CROP_STORE_W, CROP_STORE_H = 60, 80   # cached at this size
CROP_TRAIN_W, CROP_TRAIN_H = 48, 64   # network input


def extract_crop(
    image: np.ndarray,
    box: np.ndarray,
    out_w: int,
    out_h: int,
    pad: float = 0.14,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Cut one tile out of a scene, with optional jitter.

    The padding keeps a little table around the tile so the classifier sees the
    face edge, which is how a human tells a nine of circles from an eight when
    the crop clips. Jitter reproduces the detector's localisation error at
    training time.
    """
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bw *= 1 + 2 * pad
    bh *= 1 + 2 * pad

    if rng is not None:
        cx += rng.normal(0, bw * 0.035)
        cy += rng.normal(0, bh * 0.035)
        scale = rng.uniform(0.92, 1.10)
        bw *= scale
        bh *= scale

    x0i, y0i = int(round(cx - bw / 2)), int(round(cy - bh / 2))
    x1i, y1i = int(round(cx + bw / 2)), int(round(cy + bh / 2))

    h, w = image.shape[:2]
    pad_l, pad_t = max(0, -x0i), max(0, -y0i)
    pad_r, pad_b = max(0, x1i - w), max(0, y1i - h)
    region = image[max(0, y0i) : min(h, y1i), max(0, x0i) : min(w, x1i)]
    if region.size == 0:
        return np.full((out_h, out_w, 3), 114, np.uint8)
    if pad_l or pad_t or pad_r or pad_b:
        region = cv2.copyMakeBorder(
            region, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_REPLICATE
        )
    # Interpolation is chosen explicitly rather than left to INTER_AREA in both
    # directions. INTER_AREA silently degenerates to nearest-neighbour when
    # upscaling, which the TypeScript side cannot reproduce and which would
    # make the app preprocess differently than training did for the small
    # crops that come from a distant hand.
    upscaling = region.shape[1] < out_w or region.shape[0] < out_h
    interpolation = cv2.INTER_LINEAR if upscaling else cv2.INTER_AREA
    return cv2.resize(region, (out_w, out_h), interpolation=interpolation)


def build_crop_store(roots: list[Path], out_dir: Path, seed: int = 0) -> None:
    """Pre-extract every labelled tile into one memmapped uint8 array.

    Decoding a 960x720 JPEG to lift a single 60x80 crop costs more than the
    forward pass it feeds, so crops are cached once. Storing them larger than
    the network input leaves room for random-resized cropping each epoch.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    records = load_annotations(roots)
    total = sum(len(r["labels"]) for _p, r in records)

    store = np.lib.format.open_memmap(
        out_dir / "crops.npy", mode="w+", dtype=np.uint8,
        shape=(total, CROP_STORE_H, CROP_STORE_W, 3),
    )
    labels = np.zeros(total, np.int64)
    rng = np.random.default_rng(seed)

    cursor = 0
    for i, (path, record) in enumerate(records):
        image = cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        boxes = np.array(record["boxes"], np.float32).reshape(-1, 4)
        for box, label in zip(boxes, record["labels"]):
            store[cursor] = extract_crop(image, box, CROP_STORE_W, CROP_STORE_H, rng=rng)
            labels[cursor] = label
            cursor += 1
        if (i + 1) % 500 == 0:
            print(f"  {i + 1}/{len(records)} scenes, {cursor} crops", flush=True)

    store.flush()
    np.save(out_dir / "labels.npy", labels[:cursor])
    counts = np.bincount(labels[:cursor], minlength=NUM_CLASSES)
    print(f"Cached {cursor} crops -> {out_dir}")
    print(f"  per-class min {counts.min()}, median {int(np.median(counts))}, max {counts.max()}")


class CropDataset(Dataset):
    """Cached tile crops with photometric and geometric augmentation."""

    def __init__(self, store_dir: Path, train: bool = True):
        self.store_dir = Path(store_dir)
        self.labels = np.load(self.store_dir / "labels.npy")
        self.train = train
        self._crops: np.ndarray | None = None

    @property
    def crops(self) -> np.ndarray:
        """The crop store, opened on first use rather than in `__init__`.

        Windows spawns DataLoader workers by pickling the dataset, and a memmap
        pickles as its whole contents rather than as a reference - gigabytes per
        worker. Past about 2 GB the spawn fails outright with a truncated
        pickle, which is what concatenating a real and a synthetic store used to
        do. Opening lazily means each worker maps the file itself and nothing
        large crosses the pipe.
        """
        if self._crops is None:
            self._crops = np.load(self.store_dir / "crops.npy", mmap_mode="r")[: len(self.labels)]
        return self._crops

    def __getstate__(self) -> dict:
        # Belt and braces: if the parent process has already touched the store
        # before workers spawn, the open memmap would be pickled with it. Drop
        # it so the worker always maps the file for itself.
        return {**self.__dict__, "_crops": None}

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int):
        crop = np.asarray(self.crops[index])
        rng = np.random.default_rng()

        if self.train:
            # Random-resized crop: geometric jitter on top of what was baked in.
            sw = int(CROP_STORE_W * rng.uniform(0.86, 1.0))
            sh = int(CROP_STORE_H * rng.uniform(0.86, 1.0))
            x = int(rng.integers(0, CROP_STORE_W - sw + 1))
            y = int(rng.integers(0, CROP_STORE_H - sh + 1))
            crop = crop[y : y + sh, x : x + sw]

            if rng.random() < 0.35:
                angle = rng.uniform(-7, 7)
                h, w = crop.shape[:2]
                matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
                crop = cv2.warpAffine(crop, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)

        crop = cv2.resize(crop, (CROP_TRAIN_W, CROP_TRAIN_H), interpolation=cv2.INTER_AREA)

        if self.train:
            crop = crop.astype(np.float32)
            crop *= rng.uniform(0.78, 1.22)
            crop += rng.uniform(-24, 24)
            crop *= np.array(
                [rng.uniform(0.93, 1.07), rng.uniform(0.95, 1.05), rng.uniform(0.92, 1.08)],
                np.float32,
            )
            crop = np.clip(crop, 0, 255)
            if rng.random() < 0.3:
                crop = cv2.GaussianBlur(crop, (3, 3), 0)
            crop = np.clip(crop + rng.normal(0, rng.uniform(0, 7), crop.shape), 0, 255).astype(np.uint8)

        return normalise(crop), int(self.labels[index])
