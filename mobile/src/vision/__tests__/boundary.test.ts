import { clampBox, handBoundary, largestCluster, withinBoundary } from '../boundary';
import type { Detection } from '../ordering';
import type { TileCode } from '@/tiles/tileset';

const W = 40;
const H = 53;

/** A row of touching tiles starting at (x, y). */
function row(x: number, y: number, count: number, code: TileCode = 'man1'): Detection[] {
  return Array.from({ length: count }, (_, i) => ({
    box: [x + i * W, y, x + i * W + W, y + H] as [number, number, number, number],
    code,
    confidence: 0.9,
  }));
}

describe('largestCluster', () => {
  it('keeps a single row together', () => {
    expect(largestCluster(row(100, 100, 14))).toHaveLength(14);
  });

  it('keeps a row with an exposed meld set apart together', () => {
    // Concealed run, then a gap of half a tile, then a meld of three.
    const hand = [...row(100, 100, 10), ...row(100 + 10 * W + W * 0.5, 100, 3)];
    expect(largestCluster(hand)).toHaveLength(13);
  });

  it('keeps two rows together', () => {
    const hand = [...row(100, 100, 8), ...row(100, 100 + H * 1.3, 8)];
    expect(largestCluster(hand)).toHaveLength(16);
  });

  it('drops tiles sitting far away across the table', () => {
    const hand = row(100, 400, 14);
    const wall = row(100, 40, 6); // well above, a wall in the background
    const stray = row(900, 60, 2);
    const cluster = largestCluster([...hand, ...wall, ...stray]);
    expect(cluster).toHaveLength(14);
    // The hand occupies the first 14 entries of the combined array.
    expect(Math.min(...cluster)).toBe(0);
    expect(Math.max(...cluster)).toBe(13);
  });

  it('handles the degenerate inputs', () => {
    expect(largestCluster([])).toEqual([]);
    expect(largestCluster(row(0, 0, 1))).toEqual([0]);
  });
});

describe('handBoundary', () => {
  it('bounds the hand and not the stray tiles', () => {
    const hand = row(100, 400, 14);
    const stray = row(900, 60, 3);
    const box = handBoundary([...hand, ...stray], 1200, 800)!;

    expect(box[0]).toBeLessThan(100);
    expect(box[2]).toBeGreaterThan(100 + 14 * W);
    // Nowhere near the stray tiles up at y=60.
    expect(box[1]).toBeGreaterThan(300);
  });

  it('never leaves the image', () => {
    const box = handBoundary(row(0, 0, 5), 300, 100)!;
    expect(box[0]).toBeGreaterThanOrEqual(0);
    expect(box[1]).toBeGreaterThanOrEqual(0);
    expect(box[2]).toBeLessThanOrEqual(300);
    expect(box[3]).toBeLessThanOrEqual(100);
  });

  it('is null when there is nothing to bound', () => {
    expect(handBoundary([], 100, 100)).toBeNull();
  });
});

describe('withinBoundary', () => {
  it('filters by centre, so a tile clipped by the box still counts', () => {
    const hand = row(100, 100, 4);
    // Boundary cuts through the last tile but contains its centre.
    const boundary = [90, 90, 100 + 3 * W + W * 0.75, 170] as const;
    expect(withinBoundary(hand, boundary)).toHaveLength(4);
  });

  it('passes everything through when there is no boundary', () => {
    expect(withinBoundary(row(0, 0, 3), null)).toHaveLength(3);
  });
});

describe('clampBox', () => {
  it('keeps a box inside the image and non-degenerate', () => {
    expect(clampBox([-50, -50, 5000, 5000], 400, 300)).toEqual([0, 0, 400, 300]);
    const collapsed = clampBox([200, 150, 100, 100], 400, 300);
    expect(collapsed[2]).toBeGreaterThan(collapsed[0]);
    expect(collapsed[3]).toBeGreaterThan(collapsed[1]);
  });
});
