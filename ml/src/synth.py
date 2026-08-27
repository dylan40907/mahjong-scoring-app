"""Procedural photo-realistic mahjong scenes with exact ground truth.

No public annotated mahjong dataset was reachable from this environment
(Roboflow, Kaggle and HuggingFace are all blocked), so the training set is
synthesised. That turns out to be an advantage rather than a compromise: the
labels are exact by construction, rare tiles can be oversampled at will, and
the nuisance factors that actually break a tile detector - viewing angle,
table surface, colour temperature, tile spacing, partial occlusion - become
knobs rather than hopes.

A scene is built in four stages:

  1. Lay tiles out on a flat canvas in hand-like arrangements, recording each
     tile's four corners exactly.
  2. Warp the whole canvas by a random homography that mimics a phone held
     over a table, carrying the corner points through the same transform.
  3. Composite onto a procedurally generated table surface with contact
     shadows.
  4. Degrade the result the way a phone camera would: uneven lighting,
     vignetting, white balance drift, motion blur, sensor noise, JPEG.

Ground truth boxes are the axis-aligned hulls of the warped corners, so they
stay correct through every stage.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from tileset import TILES, BY_CODE, Tile, deck  # noqa: E402

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets" / "tiles"


# --------------------------------------------------------------------------
# Procedural noise
# --------------------------------------------------------------------------

def value_noise(h: int, w: int, octaves: int, rng: np.random.Generator) -> np.ndarray:
    """Multi-octave value noise in [0, 1]. Cheap stand-in for Perlin.

    Accumulated at reduced resolution and upscaled once; the octaves are all
    low-frequency relative to the output, so nothing visible is lost and the
    cost drops by roughly the square of the reduction.
    """
    sh, sw = max(8, h // 4), max(8, w // 4)
    out = np.zeros((sh, sw), np.float32)
    amplitude, total = 1.0, 0.0
    for octave in range(octaves):
        size = max(2, 2 ** (octave + 2))
        grid = rng.random((size, size)).astype(np.float32)
        out += cv2.resize(grid, (sw, sh), interpolation=cv2.INTER_CUBIC) * amplitude
        total += amplitude
        amplitude *= 0.5
    out = np.clip(out / total, 0.0, 1.0)
    return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)


# --------------------------------------------------------------------------
# Table surfaces
# --------------------------------------------------------------------------

FELT_COLOURS = [
    (34, 78, 52), (28, 62, 44), (22, 54, 68), (58, 40, 34),
    (40, 44, 48), (72, 62, 48), (24, 36, 30), (96, 34, 38),
]
WOOD_COLOURS = [(112, 78, 48), (86, 58, 36), (140, 104, 68), (62, 42, 28)]


def _felt(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    base = np.array(FELT_COLOURS[rng.integers(len(FELT_COLOURS))], np.float32)
    fibre = value_noise(h, w, 5, rng)[..., None]
    grain = rng.normal(0, 5.0, (h, w, 1)).astype(np.float32)
    return base * (0.82 + 0.36 * fibre) + grain


def _wood(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    base = np.array(WOOD_COLOURS[rng.integers(len(WOOD_COLOURS))], np.float32)
    # Many fine rings with a small warp, rather than a few broad waves - a
    # table top fills the frame, so the grain reads as texture, not stripes.
    y = np.linspace(0, rng.uniform(26, 60), h, dtype=np.float32)[:, None]
    rings = np.sin((y + 0.9 * value_noise(h, w, 3, rng)) * math.pi) * 0.5 + 0.5
    rings = rings ** 2  # sharp dark lines, wide light bands
    grain = rng.normal(0, 3.5, (h, w, 1)).astype(np.float32)
    return base * (0.90 + 0.20 * rings[..., None]) + grain


def _cloth(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    base = np.array(FELT_COLOURS[rng.integers(len(FELT_COLOURS))], np.float32)
    weave_y = (np.arange(h) % rng.integers(3, 6) == 0).astype(np.float32)[:, None]
    weave_x = (np.arange(w) % rng.integers(3, 6) == 0).astype(np.float32)[None, :]
    weave = (weave_x + weave_y)[..., None]
    return base * (0.9 + 0.16 * weave) + value_noise(h, w, 4, rng)[..., None] * 18


def make_background(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    kind = rng.choice(["felt", "wood", "cloth"], p=[0.5, 0.28, 0.22])
    surface = {"felt": _felt, "wood": _wood, "cloth": _cloth}[kind](h, w, rng)
    return np.clip(surface, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Tile sprites
# --------------------------------------------------------------------------

class TileSprites:
    """Loads the 42 faces once and hands out per-scene appearance variants."""

    def __init__(self, asset_dir: Path = ASSET_DIR):
        self._faces: dict[str, np.ndarray] = {}
        for tile in TILES:
            img = Image.open(asset_dir / f"{tile.code}.png").convert("RGBA")
            self._faces[tile.code] = np.array(img)
        self._back = np.array(Image.open(asset_dir / "_back.png").convert("RGBA"))

    def face(self, code: str) -> np.ndarray:
        return self._faces[code]

    @property
    def back(self) -> np.ndarray:
        return self._back


def style_tile(rgba: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Vary one tile's ivory tone, ink strength and edge wear.

    Real sets differ from each other and individual tiles differ within a set;
    without this the model latches onto one exact shade of bone white.
    """
    out = rgba.astype(np.float32).copy()
    rgb, alpha = out[..., :3], out[..., 3:4]

    # Ivory drifts warm or cool between sets.
    tint = np.array([rng.uniform(0.94, 1.06), rng.uniform(0.95, 1.04), rng.uniform(0.88, 1.04)], np.float32)
    rgb *= tint
    rgb *= rng.uniform(0.86, 1.08)

    # Engraved ink fades with age; pull dark pixels toward the face colour.
    if rng.random() < 0.5:
        luminance = rgb.mean(axis=2, keepdims=True)
        ink = np.clip(1.0 - luminance / 190.0, 0, 1)
        rgb += ink * rng.uniform(6, 34)

    # Bevelled edge: the rim catches light, the outermost pixels darken.
    h, w = alpha.shape[:2]
    solid = (alpha[..., 0] > 128).astype(np.uint8)
    eroded = cv2.erode(solid, np.ones((9, 9), np.uint8), iterations=1)
    rim = (solid - eroded).astype(np.float32)[..., None]
    rgb += rim * rng.uniform(-26, 30)

    return np.concatenate([np.clip(rgb, 0, 255), alpha], axis=2).astype(np.uint8)


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------

@dataclass
class Placement:
    code: str
    corners: np.ndarray  # (4, 2) float32, clockwise from top-left

    def bbox(self) -> tuple[float, float, float, float]:
        xs, ys = self.corners[:, 0], self.corners[:, 1]
        return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())


# How hands are actually laid out at a table. Group sizes describe runs of
# touching tiles; larger gaps fall between groups, the way exposed melds are
# separated from a concealed hand.
LAYOUT_STYLES = [
    ("single_row", 0.46),
    ("row_with_melds", 0.26),
    ("two_rows", 0.18),
    ("bonus_row", 0.10),
]

HAND_SIZES = [13, 14, 16, 17, 18]


def _sample_codes(n: int, rng: np.random.Generator, bonus_heavy: bool) -> list[str]:
    if bonus_heavy:
        bonus = [t.code for t in TILES if t.is_bonus]
        others = [t.code for t in TILES if not t.is_bonus]
        picks = list(rng.choice(bonus, size=min(n, rng.integers(4, 9)), replace=True))
        while len(picks) < n:
            picks.append(str(rng.choice(others)))
        rng.shuffle(picks)
        return picks[:n]

    # A real hand is drawn without replacement from a 144-tile wall, which
    # naturally limits duplicates to four of a kind.
    wall = [t.code for t in deck()]
    idx = rng.choice(len(wall), size=n, replace=False)
    return [wall[i] for i in idx]


def _row_groups(count: int, rng: np.random.Generator, melds: bool) -> list[int]:
    if not melds:
        return [count]
    groups: list[int] = []
    remaining = count
    while remaining > 0:
        if remaining <= 4:
            groups.append(remaining)
            break
        size = int(rng.choice([3, 3, 4, 5, 6, 7], p=[0.26, 0.24, 0.2, 0.12, 0.1, 0.08]))
        size = min(size, remaining)
        groups.append(size)
        remaining -= size
    rng.shuffle(groups)
    return groups


def build_layout(
    canvas_w: int,
    canvas_h: int,
    rng: np.random.Generator,
) -> tuple[list[tuple[str, np.ndarray]], bool]:
    """Return (code, corner) pairs on a flat canvas, plus a bonus-heavy flag."""
    style = str(rng.choice([s for s, _ in LAYOUT_STYLES], p=[p for _, p in LAYOUT_STYLES]))
    bonus_heavy = style == "bonus_row"

    if style == "two_rows":
        rows = 2
        per_row = [int(rng.choice(HAND_SIZES)) // 2 + int(rng.integers(0, 3)) for _ in range(2)]
    elif style == "bonus_row":
        rows = 1
        per_row = [int(rng.integers(5, 11))]
    else:
        rows = 1
        per_row = [int(rng.choice(HAND_SIZES))]

    total = sum(per_row)
    codes = _sample_codes(total, rng, bonus_heavy)

    # Size tiles so the widest row spans most of the frame.
    widest = max(per_row)
    tile_w = canvas_w * rng.uniform(0.80, 0.94) / (widest + 0.6 * max(0, len(_row_groups(widest, rng, style == "row_with_melds")) - 1))
    tile_w = min(tile_w, canvas_h / (rows * 1.55))
    tile_h = tile_w * 4 / 3

    placements: list[tuple[str, np.ndarray]] = []
    cursor = 0
    row_gap = tile_h * rng.uniform(0.18, 0.42)
    block_h = rows * tile_h + (rows - 1) * row_gap
    y0 = (canvas_h - block_h) / 2 + rng.uniform(-canvas_h * 0.06, canvas_h * 0.06)

    for row in range(rows):
        count = per_row[row]
        groups = _row_groups(count, rng, style == "row_with_melds")
        gap_between = tile_w * rng.uniform(0.35, 0.75)
        touch = tile_w * rng.uniform(0.002, 0.045)

        row_w = count * tile_w + touch * (count - len(groups)) + gap_between * (len(groups) - 1)
        x = (canvas_w - row_w) / 2 + rng.uniform(-canvas_w * 0.04, canvas_w * 0.04)
        y = y0 + row * (tile_h + row_gap)

        for group in groups:
            for _ in range(group):
                code = codes[cursor]
                cursor += 1
                # Tiles standing in a row are never perfectly aligned.
                jitter_y = rng.normal(0, tile_h * 0.012)
                angle = math.radians(rng.normal(0, 1.4))
                cx, cy = x + tile_w / 2, y + tile_h / 2 + jitter_y
                hw, hh = tile_w / 2, tile_h / 2
                corners = np.array(
                    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], np.float32
                )
                rot = np.array(
                    [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]],
                    np.float32,
                )
                corners = corners @ rot.T + np.array([cx, cy], np.float32)
                placements.append((code, corners))
                x += tile_w + touch
            x += gap_between - touch

    return placements, bonus_heavy


# --------------------------------------------------------------------------
# Compositing
# --------------------------------------------------------------------------

def _warp_sprite(sprite: np.ndarray, dest: np.ndarray, canvas: np.ndarray) -> None:
    """Alpha-composite a tile sprite onto canvas at the given quadrilateral.

    Warping is confined to the destination bounding box. Warping each sprite
    across the whole canvas instead costs the same as a full-frame resample
    per tile, which dominates generation time once a scene holds sixteen of
    them.
    """
    ch, cw = canvas.shape[:2]
    x0 = int(math.floor(dest[:, 0].min())) - 1
    y0 = int(math.floor(dest[:, 1].min())) - 1
    x1 = int(math.ceil(dest[:, 0].max())) + 1
    y1 = int(math.ceil(dest[:, 1].max())) + 1
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(cw, x1), min(ch, y1)
    if x1 <= x0 or y1 <= y0:
        return

    h, w = sprite.shape[:2]
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    local = dest.astype(np.float32) - np.array([x0, y0], np.float32)
    matrix = cv2.getPerspectiveTransform(src, local)
    warped = cv2.warpPerspective(
        sprite, matrix, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0)
    )

    roi = canvas[y0:y1, x0:x1]
    alpha = warped[..., 3:4].astype(np.float32) / 255.0
    roi[..., :3] = warped[..., :3] * alpha + roi[..., :3] * (1 - alpha)
    roi[..., 3:4] = np.maximum(roi[..., 3:4], warped[..., 3:4])


def _contact_shadow(shape: tuple[int, int], quads, rng: np.random.Generator) -> np.ndarray:
    """Soft shadow cast by the tiles onto the table."""
    h, w = shape
    mask = np.zeros((h, w), np.float32)
    offset = np.array([rng.normal(0, w * 0.010), rng.uniform(w * 0.004, w * 0.018)], np.float32)
    for quad in quads:
        cv2.fillConvexPoly(mask, (quad + offset).astype(np.int32), 1.0)
    blur = int(max(3, w * rng.uniform(0.005, 0.018))) | 1
    return cv2.GaussianBlur(mask, (blur, blur), 0) * rng.uniform(0.25, 0.60)


def _perspective_matrix(w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    """A phone held over a table: mostly top-down, tilted up to ~35 degrees."""
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    strength = rng.uniform(0.0, 0.15)
    tilt = rng.uniform(-1.0, 1.0)
    dst = src.copy()
    dst[0, 0] += w * strength * max(0.0, tilt)
    dst[1, 0] -= w * strength * max(0.0, tilt)
    dst[3, 0] += w * strength * max(0.0, -tilt)
    dst[2, 0] -= w * strength * max(0.0, -tilt)
    shear = rng.uniform(-0.05, 0.05)
    dst[:, 0] += (dst[:, 1] - h / 2) * shear
    dst[:, 1] += (dst[:, 0] - w / 2) * rng.uniform(-0.04, 0.04)
    dst += rng.normal(0, w * 0.006, dst.shape).astype(np.float32)
    return cv2.getPerspectiveTransform(src, dst.astype(np.float32))


def _rotation_matrix(w: int, h: int, degrees: float) -> np.ndarray:
    affine = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return np.vstack([affine, [0.0, 0.0, 1.0]]).astype(np.float32)


def _framing_matrix(
    canvas_w: int,
    canvas_h: int,
    out_w: int,
    out_h: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Choose how tightly the camera frames the tiles.

    A sixteen-tile row is twelve tile-heights wide, so a photo containing the
    whole hand necessarily renders each tile small. Real users mix that with
    closer shots of part of the hand, and the detector has to handle both, so
    the crop window is sampled rather than fixed.
    """
    tightness = rng.choice([0.55, 0.75, 1.0], p=[0.22, 0.30, 0.48])
    view_w = canvas_w * float(tightness)
    view_h = view_w * out_h / out_w
    if view_h > canvas_h:
        view_h = canvas_h
        view_w = view_h * out_w / out_h

    max_dx = max(0.0, (canvas_w - view_w) / 2)
    max_dy = max(0.0, (canvas_h - view_h) / 2)
    cx = canvas_w / 2 + rng.uniform(-max_dx, max_dx) * 0.85
    cy = canvas_h / 2 + rng.uniform(-max_dy, max_dy) * 0.85

    scale_x, scale_y = out_w / view_w, out_h / view_h
    return np.array(
        [
            [scale_x, 0.0, -(cx - view_w / 2) * scale_x],
            [0.0, scale_y, -(cy - view_h / 2) * scale_y],
            [0.0, 0.0, 1.0],
        ],
        np.float32,
    )


def apply_homography(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    pts = np.concatenate([points, np.ones((len(points), 1), np.float32)], axis=1)
    out = pts @ matrix.T
    return (out[:, :2] / out[:, 2:3]).astype(np.float32)


# --------------------------------------------------------------------------
# Photometric degradation
# --------------------------------------------------------------------------

def photometric(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = img.astype(np.float32)
    h, w = out.shape[:2]

    # Uneven room lighting: a broad, soft gradient.
    light = value_noise(h, w, 2, rng)[..., None]
    out *= 0.80 + 0.40 * light

    # Lens vignette.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    radius = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    out *= (1.0 - rng.uniform(0.05, 0.34) * np.clip(radius, 0, 1.4) ** 2)[..., None]

    # White balance drift between tungsten and daylight.
    out *= np.array([rng.uniform(0.90, 1.12), rng.uniform(0.95, 1.05), rng.uniform(0.88, 1.14)], np.float32)

    # Exposure and contrast.
    out = (out - 128) * rng.uniform(0.86, 1.16) + 128 + rng.uniform(-16, 20)
    out = np.clip(out, 0, 255)

    # Occasional blown highlight from a ceiling lamp.
    if rng.random() < 0.30:
        gx, gy = rng.uniform(0, w), rng.uniform(0, h)
        glare = np.exp(-(((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * (w * rng.uniform(0.06, 0.18)) ** 2)))
        out = np.clip(out + glare[..., None] * rng.uniform(25, 75), 0, 255)

    # Motion or focus blur.
    if rng.random() < 0.45:
        k = int(rng.integers(1, 4)) * 2 + 1
        if rng.random() < 0.5:
            out = cv2.GaussianBlur(out, (k, k), 0)
        else:
            kernel = np.zeros((k, k), np.float32)
            kernel[k // 2, :] = 1.0 / k
            angle = rng.uniform(0, 180)
            rot = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), angle, 1.0)
            out = cv2.filter2D(out, -1, cv2.warpAffine(kernel, rot, (k, k)))

    # Sensor noise, then JPEG.
    out = np.clip(out + rng.normal(0, rng.uniform(1.0, 7.0), out.shape), 0, 255).astype(np.uint8)
    quality = int(rng.integers(55, 96))
    ok, buf = cv2.imencode(".jpg", out, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if ok:
        out = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return out


# Hands, sleeves and shadows are what actually intrude into these photos, so
# occluders are drawn from plausible skin and fabric tones rather than random
# colours, and they enter from an edge the way a real arm does.
SKIN_TONES = [(235, 199, 168), (198, 152, 118), (150, 105, 78), (95, 64, 48), (247, 220, 195)]
FABRIC_TONES = [(38, 42, 52), (86, 92, 104), (176, 176, 172), (58, 44, 40), (24, 26, 30)]


def add_occluders(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A hand, a sleeve, or a cast shadow intruding from the frame edge."""
    if rng.random() > 0.30:
        return img

    h, w = img.shape[:2]
    layer = img.copy()
    mask = np.zeros((h, w), np.float32)
    kind = rng.random()

    if kind < 0.45:
        # Fingers reaching in: a few overlapping capsules from one edge.
        edge = int(rng.integers(0, 4))
        colour = SKIN_TONES[rng.integers(len(SKIN_TONES))]
        base_x = {0: rng.uniform(0, w), 1: float(w), 2: rng.uniform(0, w), 3: 0.0}[edge]
        base_y = {0: 0.0, 1: rng.uniform(0, h), 2: float(h), 3: rng.uniform(0, h)}[edge]
        for _ in range(int(rng.integers(2, 5))):
            tip_x = base_x + rng.normal(0, w * 0.16)
            tip_y = base_y + (1 if base_y < h / 2 else -1) * rng.uniform(h * 0.15, h * 0.45)
            cv2.line(
                mask,
                (int(base_x + rng.normal(0, w * 0.03)), int(base_y)),
                (int(tip_x), int(tip_y)),
                1.0,
                int(max(4, rng.uniform(w * 0.022, w * 0.045))),
            )
        cv2.circle(layer, (0, 0), 1, colour, -1)
        layer[:] = np.array(colour, np.uint8)
    elif kind < 0.75:
        # A sleeve or arm crossing a corner.
        colour = FABRIC_TONES[rng.integers(len(FABRIC_TONES))]
        pts = np.array(
            [
                [rng.uniform(-w * 0.1, w * 0.4), -h * 0.1],
                [rng.uniform(w * 0.2, w * 0.9), -h * 0.1],
                [rng.uniform(w * 0.1, w * 0.8), rng.uniform(h * 0.15, h * 0.6)],
                [rng.uniform(-w * 0.2, w * 0.3), rng.uniform(h * 0.1, h * 0.5)],
            ],
            np.int32,
        )
        if rng.random() < 0.5:
            pts[:, 1] = h - pts[:, 1]
        cv2.fillConvexPoly(mask, pts, 1.0)
        layer[:] = np.array(colour, np.uint8)
    else:
        # A cast shadow: darkens without replacing.
        pts = np.array(
            [
                [rng.uniform(-w * 0.2, w * 0.5), -h * 0.2],
                [rng.uniform(w * 0.3, w * 1.2), -h * 0.2],
                [rng.uniform(w * 0.2, w * 1.1), rng.uniform(h * 0.2, h * 0.9)],
                [rng.uniform(-w * 0.3, w * 0.4), rng.uniform(h * 0.1, h * 0.8)],
            ],
            np.int32,
        )
        cv2.fillConvexPoly(mask, pts, 1.0)
        layer = (img.astype(np.float32) * rng.uniform(0.35, 0.62)).astype(np.uint8)

    # Soft edges: nothing in a photograph has a hard alpha boundary.
    blur = int(max(3, w * rng.uniform(0.004, 0.016))) | 1
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)[..., None]
    mask = np.clip(mask, 0, 1) * rng.uniform(0.80, 1.0)
    return (layer.astype(np.float32) * mask + img.astype(np.float32) * (1 - mask)).astype(np.uint8)


# --------------------------------------------------------------------------
# Scene assembly
# --------------------------------------------------------------------------

@dataclass
class Scene:
    image: np.ndarray            # HxWx3 uint8, RGB
    boxes: np.ndarray            # (N, 4) float32 xyxy
    labels: np.ndarray           # (N,) int64 class indices
    quads: np.ndarray            # (N, 4, 2) float32 corners


MIN_VISIBLE_FRACTION = 0.55


def generate_scene(
    sprites: TileSprites,
    rng: np.random.Generator,
    width: int = 960,
    height: int = 720,
) -> Scene:
    """Build one photo-realistic scene together with its exact ground truth.

    Layout happens on a flat virtual table, then a single composed transform -
    perspective, roll, and camera framing - carries both the sprites and their
    corner points into image space. Composing first means each tile is
    resampled exactly once, which keeps the engraved detail on a 40-pixel-wide
    tile from turning to mush.
    """
    canvas_w, canvas_h = width * 2, height * 2
    placements, _bonus_heavy = build_layout(canvas_w, canvas_h, rng)

    roll = float(rng.normal(0, 4.0))
    if rng.random() < 0.12:
        roll += float(rng.choice([-1.0, 1.0])) * rng.uniform(8.0, 22.0)

    transform = (
        _framing_matrix(canvas_w, canvas_h, width, height, rng)
        @ _rotation_matrix(canvas_w, canvas_h, roll)
        @ _perspective_matrix(canvas_w, canvas_h, rng)
    ).astype(np.float32)

    quads = [apply_homography(corners, transform) for _code, corners in placements]

    # Table surface first, then the shadow the tiles cast on it.
    background = make_background(height, width, rng).astype(np.float32)
    background *= (1.0 - _contact_shadow((height, width), quads, rng))[..., None]

    canvas = np.zeros((height, width, 4), np.float32)
    canvas[..., :3] = background
    for (code, _corners), quad in zip(placements, quads):
        _warp_sprite(style_tile(sprites.face(code), rng), quad, canvas)

    boxes, labels, kept_quads = [], [], []
    for (code, _corners), quad in zip(placements, quads):
        x0, y0 = float(quad[:, 0].min()), float(quad[:, 1].min())
        x1, y1 = float(quad[:, 0].max()), float(quad[:, 1].max())
        full_area = max(1e-6, (x1 - x0) * (y1 - y0))
        cx0, cy0 = max(0.0, x0), max(0.0, y0)
        cx1, cy1 = min(float(width), x1), min(float(height), y1)
        if cx1 - cx0 < 6 or cy1 - cy0 < 8:
            continue
        if ((cx1 - cx0) * (cy1 - cy0)) / full_area < MIN_VISIBLE_FRACTION:
            continue
        boxes.append([cx0, cy0, cx1, cy1])
        labels.append(BY_CODE[code].index)
        kept_quads.append(quad)

    image = photometric(np.clip(canvas[..., :3], 0, 255).astype(np.uint8), rng)
    image = add_occluders(image, rng)

    return Scene(
        image=image,
        boxes=np.array(boxes, np.float32).reshape(-1, 4),
        labels=np.array(labels, np.int64),
        quads=np.array(kept_quads, np.float32).reshape(-1, 4, 2),
    )


# --------------------------------------------------------------------------
# Dataset writer
# --------------------------------------------------------------------------

def build_dataset(out_dir: Path, count: int, seed: int, width: int, height: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    img_dir = out_dir / "images"
    img_dir.mkdir(exist_ok=True)

    sprites = TileSprites()
    rng = np.random.default_rng(seed)
    records = []

    for i in range(count):
        scene = generate_scene(sprites, rng, width, height)
        if len(scene.boxes) == 0:
            continue
        name = f"{i:06d}.jpg"
        cv2.imwrite(
            str(img_dir / name),
            cv2.cvtColor(scene.image, cv2.COLOR_RGB2BGR),
            [int(cv2.IMWRITE_JPEG_QUALITY), 92],
        )
        records.append(
            {
                "image": name,
                "width": width,
                "height": height,
                "boxes": scene.boxes.round(2).tolist(),
                "labels": scene.labels.tolist(),
            }
        )
        if (i + 1) % 250 == 0:
            print(f"  {i + 1}/{count}", flush=True)

    (out_dir / "annotations.json").write_text(json.dumps(records))
    total = sum(len(r["labels"]) for r in records)
    print(f"Wrote {len(records)} scenes, {total} tile instances -> {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--count", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--preview", type=Path, default=None)
    args = parser.parse_args()

    if args.preview:
        sprites = TileSprites()
        rng = np.random.default_rng(args.seed)
        tiles = []
        for _ in range(6):
            scene = generate_scene(sprites, rng, 480, 360)
            img = cv2.cvtColor(scene.image, cv2.COLOR_RGB2BGR)
            for (x0, y0, x1, y1) in scene.boxes.astype(int):
                cv2.rectangle(img, (x0, y0), (x1, y1), (120, 230, 60), 1)
            tiles.append(img)
        grid = np.vstack([np.hstack(tiles[0:3]), np.hstack(tiles[3:6])])
        cv2.imwrite(str(args.preview), grid)
        print(f"Preview -> {args.preview}")
        return

    build_dataset(args.out, args.count, args.seed, args.width, args.height)


if __name__ == "__main__":
    main()
