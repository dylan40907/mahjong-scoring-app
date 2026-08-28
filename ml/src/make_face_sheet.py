"""Print a layout guide for photographing a real tile set.

The cheapest possible real-world labelling: lay physical tiles out in the order
below, photograph the arrangement a dozen times under different conditions, and
every shot has the same label sequence - the frozen class order from
tileset.py, indices 0 to 41. One typed sequence covers every photograph, and it
covers all 42 classes including the flowers and seasons, which are only 8 of 144
tiles in a natural draw and would otherwise barely appear.

Light background on purpose: this is meant to be printed or held on a second
screen while arranging tiles.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from tileset import TILES  # noqa: E402

COLS = 7
TILE_W = 132
PAD = 22
LABEL_H = 52
MARGIN = 46
HEADER_H = 132

INK = (26, 30, 28)
MUTED = (122, 132, 127)
RULE = (208, 212, 209)
PAPER = (250, 249, 246)

# This sheet was first generated on Linux. Regenerating it anywhere else has to
# find a different face, and falling through to Pillow's bitmap default renders
# the class indices at 11px - too small to read from across a table, which is
# the one job this page has. Each entry is (regular, bold).
FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/segoeuib.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf",
     "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]


def _font(size: int, bold: bool = False):
    for regular, emphasis in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(emphasis if bold else regular, size)
        except OSError:
            continue
    # Pillow 10.1 made the built-in default scalable; older versions reject the
    # argument and hand back the fixed-size bitmap face regardless.
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def build(tile_dir: Path) -> Image.Image:
    tile_h = round(TILE_W * 4 / 3)
    rows = (len(TILES) + COLS - 1) // COLS
    width = MARGIN * 2 + COLS * TILE_W + (COLS - 1) * PAD
    height = MARGIN * 2 + HEADER_H + rows * (tile_h + LABEL_H + PAD)

    sheet = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, MARGIN), "Tile face sheet", font=_font(38, bold=True), fill=INK)
    draw.text(
        (MARGIN, MARGIN + 50),
        "Lay tiles out in this exact order, then photograph the layout under varied lighting,",
        font=_font(21),
        fill=MUTED,
    )
    draw.text(
        (MARGIN, MARGIN + 78),
        "angles and surfaces. Every shot shares one label sequence: class index 0 through 41.",
        font=_font(21),
        fill=MUTED,
    )
    line_y = MARGIN + HEADER_H - 18
    draw.line([(MARGIN, line_y), (width - MARGIN, line_y)], fill=RULE, width=2)

    for i, tile in enumerate(TILES):
        col, row = i % COLS, i // COLS
        x = MARGIN + col * (TILE_W + PAD)
        y = MARGIN + HEADER_H + row * (tile_h + LABEL_H + PAD)

        face = Image.open(tile_dir / f"{tile.code}.png").convert("RGBA")
        face = face.resize((TILE_W, tile_h), Image.LANCZOS)
        sheet.paste(face, (x, y), face)
        draw.rectangle([x, y, x + TILE_W, y + tile_h], outline=RULE, width=1)

        # Index above, code beneath. Stacking them avoids the collision that
        # two-digit indices and long codes like `flower_chrysanthemum` cause on
        # one line, and the index is what actually gets typed when labelling.
        draw.text((x, y + tile_h + 6), str(i), font=_font(23, bold=True), fill=INK)
        code_font = _font(15 if len(tile.code) <= 12 else 12)
        draw.text((x, y + tile_h + 32), tile.code, font=code_font, fill=MUTED)

    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiles", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "tiles")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    sheet = build(args.tiles)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)

    codes = ",".join(t.code for t in TILES)
    print(f"Wrote {args.out}  ({sheet.width}x{sheet.height})")
    print(f"\nLabel sequence for any photo of this layout:\n{codes}")


if __name__ == "__main__":
    main()
