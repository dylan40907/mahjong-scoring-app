import { clampBox, fullFrame, insideBoundary, withinBoundary } from '../boundary';

const box = (x: number, y: number, w = 40, h = 54) =>
  ({ box: [x, y, x + w, y + h] as const }) as { box: readonly [number, number, number, number] };

describe('fullFrame', () => {
  it('is the whole photograph', () => {
    expect(fullFrame(1200, 500)).toEqual([0, 0, 1200, 500]);
  });

  it('is null before the image size is known', () => {
    expect(fullFrame(0, 0)).toBeNull();
    expect(fullFrame(100, 0)).toBeNull();
  });
});

describe('insideBoundary', () => {
  it('tests the centre, not the corners', () => {
    // Straddling the edge: the centre is inside, so the tile is in the hand.
    expect(insideBoundary([90, 0, 130, 54], [100, 0, 400, 100])).toBe(true);
    expect(insideBoundary([50, 0, 90, 54], [100, 0, 400, 100])).toBe(false);
  });
});

describe('withinBoundary', () => {
  it('drops what falls outside', () => {
    const detections = [box(0, 0), box(200, 0), box(900, 0)];
    expect(withinBoundary(detections, [0, 0, 400, 100])).toHaveLength(2);
  });

  it('keeps everything when there is no boundary', () => {
    const detections = [box(0, 0), box(900, 0)];
    expect(withinBoundary(detections, null)).toHaveLength(2);
  });
});

describe('clampBox', () => {
  it('keeps a dragged box inside the image', () => {
    expect(clampBox([-40, -40, 5000, 5000], 1200, 800)).toEqual([0, 0, 1200, 800]);
  });

  it('never collapses to nothing', () => {
    const [x0, y0, x1, y1] = clampBox([600, 400, 600, 400], 1200, 800);
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });
});
