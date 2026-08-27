"""Render the 42 tile faces to PNG, once, for both the app and the data pipeline.

The CC0 SVG set (FluffyStuff/riichi-mahjong-tiles) stores each symbol as a
transparent overlay and the blank tile face separately, so a finished face is
Front.svg with a symbol composited on top.

Two gaps have to be filled by hand:

  * Flowers and seasons do not exist in a Riichi set - Riichi does not use
    them - but Taiwanese, Hong Kong and MCR all do. They are drawn here from
    the tile face, a CJK glyph and a corner numeral, matching how modern
    Chinese sets present them.
  * The white dragon is a genuinely blank face in the Riichi set. Chinese and
    Taiwanese sets frame it in blue, and a detector needs the white dragon to
    be distinguishable from an unlit blank, so the frame is drawn in.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from tileset import TILES, Suit, Tile  # noqa: E402

TILE_W, TILE_H = 300, 400

# Deep, slightly desaturated inks. Physical tiles are engraved and pigment
# filled, so the colour never reaches full saturation.
FLOWER_INK = (28, 110, 66, 255)    # engraved green
SEASON_INK = (176, 44, 40, 255)    # engraved vermilion
DRAGON_BLUE = (36, 78, 148, 255)   # white dragon frame

CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in CJK_FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise RuntimeError("No CJK font available to draw flower and season tiles")


def _svg(path: Path, w: int = TILE_W, h: int = TILE_H) -> Image.Image:
    png = cairosvg.svg2png(url=str(path), output_width=w, output_height=h)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def _draw_centred(
    canvas: Image.Image,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    centre: tuple[int, int],
) -> None:
    draw = ImageDraw.Draw(canvas)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    x = centre[0] - (right + left) / 2
    y = centre[1] - (bottom + top) / 2
    draw.text((x, y), text, font=font, fill=fill)


def _bonus_face(face: Image.Image, tile: Tile) -> Image.Image:
    """Draw a flower or season tile: large glyph, small corner numeral."""
    canvas = face.copy()
    ink = FLOWER_INK if tile.suit is Suit.FLOWER else SEASON_INK

    _draw_centred(canvas, tile.glyph, _load_font(196), ink, (TILE_W // 2, 218))
    _draw_centred(canvas, str(tile.rank), _load_font(64), ink, (68, 74))
    return canvas


def _white_dragon_face(face: Image.Image) -> Image.Image:
    """Frame the blank face in blue, as Chinese and Taiwanese sets do."""
    canvas = face.copy()
    draw = ImageDraw.Draw(canvas)
    inset_x, inset_y, width = 58, 66, 11
    draw.rounded_rectangle(
        [inset_x, inset_y, TILE_W - inset_x, TILE_H - inset_y],
        radius=14,
        outline=DRAGON_BLUE,
        width=width,
    )
    # A short diagonal in each corner, the way the engraving usually reads.
    for x0, y0, x1, y1 in (
        (inset_x + 26, inset_y + 26, inset_x + 62, inset_y + 62),
        (TILE_W - inset_x - 26, inset_y + 26, TILE_W - inset_x - 62, inset_y + 62),
        (inset_x + 26, TILE_H - inset_y - 26, inset_x + 62, TILE_H - inset_y - 62),
        (TILE_W - inset_x - 26, TILE_H - inset_y - 26, TILE_W - inset_x - 62, TILE_H - inset_y - 62),
    ):
        draw.line([x0, y0, x1, y1], fill=DRAGON_BLUE, width=7)
    return canvas


def render_all(svg_dir: Path, out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    face = _svg(svg_dir / "Front.svg")
    written: dict[str, Path] = {}

    for tile in TILES:
        if tile.code == "white":
            image = _white_dragon_face(face)
        elif tile.is_bonus:
            image = _bonus_face(face, tile)
        else:
            assert tile.source is not None
            image = face.copy()
            image.alpha_composite(_svg(svg_dir / f"{tile.source}.svg"))

        path = out_dir / f"{tile.code}.png"
        image.save(path)
        written[tile.code] = path

    # The tile back, used to dress synthetic scenes with face-down tiles.
    back = _svg(svg_dir / "Back.svg")
    back.save(out_dir / "_back.png")
    return written


def contact_sheet(tile_dir: Path, out_path: Path, cols: int = 9, scale: float = 0.5) -> None:
    w, h = int(TILE_W * scale), int(TILE_H * scale)
    pad, ground = 10, (24, 30, 28, 255)
    rows = (len(TILES) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * (w + pad) + pad, rows * (h + pad) + pad), ground)
    for i, tile in enumerate(TILES):
        img = Image.open(tile_dir / f"{tile.code}.png").convert("RGBA").resize((w, h), Image.LANCZOS)
        x = pad + (i % cols) * (w + pad)
        y = pad + (i // cols) * (h + pad)
        sheet.alpha_composite(img, (x, y))
    sheet.convert("RGB").save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--svg-dir", type=Path, default=Path("tiles-src/Regular"))
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "tiles")
    parser.add_argument("--sheet", type=Path, default=None)
    args = parser.parse_args()

    written = render_all(args.svg_dir, args.out)
    print(f"Rendered {len(written)} tile faces to {args.out}")
    if args.sheet:
        contact_sheet(args.out, args.sheet)
        print(f"Contact sheet: {args.sheet}")


if __name__ == "__main__":
    main()
