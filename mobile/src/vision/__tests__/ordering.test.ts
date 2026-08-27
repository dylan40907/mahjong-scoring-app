import type { TileCode } from '@/tiles/tileset';
import { estimateRotation, orderDetections, splitHandAndMelds, type Detection } from '../ordering';

const TILE_W = 40;
const TILE_H = 53;

/** Build a row of tiles starting at (x, y), optionally rotated about (x, y). */
function row(
  codes: TileCode[],
  start: { x: number; y: number },
  options: { degrees?: number; gapsAfter?: number[]; gapSize?: number } = {},
): Detection[] {
  const radians = ((options.degrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const gapsAfter = new Set(options.gapsAfter ?? []);
  const gapSize = options.gapSize ?? TILE_W;

  let offset = 0;
  return codes.map((code, index) => {
    const localX = offset;
    offset += TILE_W + (gapsAfter.has(index) ? gapSize : 0);
    const cx = start.x + localX * cos;
    const cy = start.y + localX * sin;
    return {
      box: [cx - TILE_W / 2, cy - TILE_H / 2, cx + TILE_W / 2, cy + TILE_H / 2] as const,
      code,
      confidence: 0.9,
    };
  });
}

const HAND: TileCode[] = [
  'man1', 'man2', 'man3', 'pin4', 'pin5', 'pin6', 'sou7', 'sou8',
  'sou9', 'east', 'south', 'west', 'north', 'red',
];

function codesOf(groups: { code: TileCode }[][]): TileCode[] {
  return groups.flat().map((tile) => tile.code);
}

describe('spatial ordering', () => {
  it('reads a level row left to right regardless of input order', () => {
    const detections = row(HAND, { x: 100, y: 300 });
    const shuffled = [...detections].reverse();
    const result = orderDetections(shuffled);

    expect(result.groups).toHaveLength(1);
    expect(codesOf(result.groups)).toEqual(HAND);
  });

  it('reads a single tilted row correctly', () => {
    const detections = row(HAND, { x: 80, y: 400 }, { degrees: 12 });
    const result = orderDetections(detections);

    expect(result.groups).toHaveLength(1);
    expect(codesOf(result.groups)).toEqual(HAND);
    expect(result.rotationDegrees).toBeCloseTo(12, 0);
  });

  it('keeps two tilted rows apart, where sorting by y interleaves them', () => {
    // At 12 degrees a fourteen-tile row climbs about 108px end to end, which is
    // more than the 85px between the two rows. The tail of the upper row is
    // therefore lower on the image than the head of the lower one, and any
    // y-first sort mixes them together.
    const upper: TileCode[] = [
      'man1', 'man2', 'man3', 'man4', 'man5', 'man6', 'man7', 'man8', 'man9',
      'east', 'south', 'west', 'north', 'red',
    ];
    const lower: TileCode[] = [
      'pin1', 'pin2', 'pin3', 'pin4', 'pin5', 'pin6', 'pin7', 'pin8', 'pin9',
      'sou1', 'sou2', 'sou3', 'sou4', 'sou5',
    ];
    const detections = [
      ...row(upper, { x: 80, y: 200 }, { degrees: 12 }),
      ...row(lower, { x: 80, y: 200 + TILE_H * 1.6 }, { degrees: 12 }),
    ];

    const naive = [...detections]
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
      .map((d) => d.code);
    expect(naive).not.toEqual([...upper, ...lower]);

    const result = orderDetections(detections);
    expect(result.groups).toHaveLength(2);
    expect(codesOf(result.groups)).toEqual([...upper, ...lower]);
  });

  it('handles a negative tilt', () => {
    const detections = row(HAND, { x: 80, y: 400 }, { degrees: -9 });
    const result = orderDetections(detections);
    expect(codesOf(result.groups)).toEqual(HAND);
    expect(result.rotationDegrees).toBeCloseTo(-9, 0);
  });

  it('separates melds from the concealed hand by the gap between them', () => {
    const codes: TileCode[] = [
      'man1', 'man1', 'man1',
      'pin2', 'pin3', 'pin4',
      'sou5', 'sou6', 'sou7', 'sou8', 'sou9', 'east', 'east', 'east',
    ];
    const detections = row(codes, { x: 60, y: 300 }, { gapsAfter: [2, 5] });
    const result = orderDetections(detections);

    expect(result.groups.map((g) => g.length)).toEqual([3, 3, 8]);
    expect(codesOf(result.groups)).toEqual(codes);
  });

  it('orders two rows top to bottom', () => {
    const top = row(['man1', 'man2', 'man3'], { x: 100, y: 200 });
    const bottom = row(['pin7', 'pin8', 'pin9'], { x: 100, y: 200 + TILE_H * 1.6 });
    const result = orderDetections([...bottom, ...top]);

    expect(result.groups).toHaveLength(2);
    expect(codesOf(result.groups)).toEqual(['man1', 'man2', 'man3', 'pin7', 'pin8', 'pin9']);
    expect(result.groups[0][0].row).toBe(0);
    expect(result.groups[1][0].row).toBe(1);
  });

  it('returns an empty hand for no detections', () => {
    const result = orderDetections([]);
    expect(result.groups).toEqual([]);
    expect(result.rotationDegrees).toBe(0);
  });

  it('does not claim a rotation from too few tiles', () => {
    expect(estimateRotation(row(['man1', 'man2'], { x: 0, y: 0 }))).toBe(0);
  });

  it('picks the largest group as the concealed hand and short groups as melds', () => {
    const codes: TileCode[] = [
      'man1', 'man1', 'man1',
      'pin2', 'pin3', 'pin4',
      'sou5', 'sou6', 'sou7', 'sou8', 'sou9', 'east', 'east', 'east',
    ];
    const detections = row(codes, { x: 60, y: 300 }, { gapsAfter: [2, 5] });
    const { concealed, melds } = splitHandAndMelds(orderDetections(detections));

    expect(melds).toHaveLength(2);
    expect(melds.map((m) => m.length)).toEqual([3, 3]);
    expect(concealed).toHaveLength(8);
  });
});
