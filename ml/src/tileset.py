"""Canonical mahjong tile set shared by the data pipeline, the models and the app.

Forty-two classes: three numbered suits of nine, four winds, three dragons,
four flowers and four seasons. Every variant this project scores draws from
this same set; only the hand size and the scoring table change.

The class index order defined here is frozen. It is baked into the exported
ONNX classifier and mirrored in mobile/src/tiles/tileset.ts, so inserting a
class in the middle would silently corrupt every prediction.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterator


class Suit(str, Enum):
    CHARACTERS = "man"   # 萬 - characters / cracks
    CIRCLES = "pin"      # 筒 - circles / dots
    BAMBOO = "sou"       # 索 - bamboo / sticks
    WIND = "wind"        # 東南西北
    DRAGON = "dragon"    # 中發白
    FLOWER = "flower"    # 梅蘭菊竹
    SEASON = "season"    # 春夏秋冬


NUMBERED_SUITS = (Suit.CHARACTERS, Suit.CIRCLES, Suit.BAMBOO)
HONOUR_SUITS = (Suit.WIND, Suit.DRAGON)
BONUS_SUITS = (Suit.FLOWER, Suit.SEASON)


@dataclass(frozen=True)
class Tile:
    """One face of the tile set.

    Attributes:
        index: Frozen class index used by the classifier head.
        code: Stable machine identifier, e.g. "man5", "east", "flower_plum".
        suit: Which family the tile belongs to.
        rank: 1-9 for numbered suits, 1-4 for winds/flowers/seasons,
            1-3 for dragons. Ordering within a suit follows convention:
            winds are E/S/W/N, dragons are red/green/white.
        glyph: The CJK character shown on the physical tile, where one exists.
        label: Short English name used in the app.
        source: Filename stem in the CC0 SVG set, or None when the face has to
            be drawn by render_tiles.py (flowers and seasons are absent from
            Riichi sets because Riichi does not use them).
    """

    index: int
    code: str
    suit: Suit
    rank: int
    glyph: str
    label: str
    source: str | None

    @property
    def is_numbered(self) -> bool:
        return self.suit in NUMBERED_SUITS

    @property
    def is_honour(self) -> bool:
        return self.suit in HONOUR_SUITS

    @property
    def is_bonus(self) -> bool:
        """Flowers and seasons sit outside the hand and never form melds."""
        return self.suit in BONUS_SUITS

    @property
    def is_terminal(self) -> bool:
        return self.is_numbered and self.rank in (1, 9)

    @property
    def is_simple(self) -> bool:
        return self.is_numbered and 2 <= self.rank <= 8


def _build() -> tuple[Tile, ...]:
    tiles: list[Tile] = []
    idx = 0

    numbered = [
        (Suit.CHARACTERS, "man", "Man", "萬", "Characters"),
        (Suit.CIRCLES, "pin", "Pin", "筒", "Circles"),
        (Suit.BAMBOO, "sou", "Sou", "索", "Bamboo"),
    ]
    for suit, code_prefix, src_prefix, _glyph, label in numbered:
        for rank in range(1, 10):
            tiles.append(
                Tile(
                    index=idx,
                    code=f"{code_prefix}{rank}",
                    suit=suit,
                    rank=rank,
                    glyph="",
                    label=f"{rank} {label}",
                    source=f"{src_prefix}{rank}",
                )
            )
            idx += 1

    winds = [
        ("east", 1, "東", "East", "Ton"),
        ("south", 2, "南", "South", "Nan"),
        ("west", 3, "西", "West", "Shaa"),
        ("north", 4, "北", "North", "Pei"),
    ]
    for code, rank, glyph, label, src in winds:
        tiles.append(Tile(idx, code, Suit.WIND, rank, glyph, label, src))
        idx += 1

    dragons = [
        ("red", 1, "中", "Red Dragon", "Chun"),
        ("green", 2, "發", "Green Dragon", "Hatsu"),
        ("white", 3, "白", "White Dragon", "Haku"),
    ]
    for code, rank, glyph, label, src in dragons:
        tiles.append(Tile(idx, code, Suit.DRAGON, rank, glyph, label, src))
        idx += 1

    flowers = [
        ("flower_plum", 1, "梅", "Plum"),
        ("flower_orchid", 2, "蘭", "Orchid"),
        ("flower_chrysanthemum", 3, "菊", "Chrysanthemum"),
        ("flower_bamboo", 4, "竹", "Bamboo Flower"),
    ]
    for code, rank, glyph, label in flowers:
        tiles.append(Tile(idx, code, Suit.FLOWER, rank, glyph, label, None))
        idx += 1

    seasons = [
        ("season_spring", 1, "春", "Spring"),
        ("season_summer", 2, "夏", "Summer"),
        ("season_autumn", 3, "秋", "Autumn"),
        ("season_winter", 4, "冬", "Winter"),
    ]
    for code, rank, glyph, label in seasons:
        tiles.append(Tile(idx, code, Suit.SEASON, rank, glyph, label, None))
        idx += 1

    return tuple(tiles)


TILES: tuple[Tile, ...] = _build()
NUM_CLASSES = len(TILES)

BY_CODE: dict[str, Tile] = {t.code: t for t in TILES}
BY_INDEX: dict[int, Tile] = {t.index: t for t in TILES}
CODES: tuple[str, ...] = tuple(t.code for t in TILES)

# Physical copies of each face in a 144-tile set: four of every suit and
# honour tile, one of every flower and season.
def copies(tile: Tile) -> int:
    return 1 if tile.is_bonus else 4


def deck() -> Iterator[Tile]:
    """Yield every physical tile in a full 144-tile set."""
    for tile in TILES:
        for _ in range(copies(tile)):
            yield tile


if __name__ == "__main__":
    assert NUM_CLASSES == 42, NUM_CLASSES
    assert len(list(deck())) == 144, len(list(deck()))
    for tile in TILES:
        print(f"{tile.index:>3}  {tile.code:<22} {tile.suit.value:<7} {tile.label}")
    print(f"\n{NUM_CLASSES} classes, {len(list(deck()))} physical tiles")
