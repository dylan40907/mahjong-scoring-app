import { containFit, placeBox } from '../overlay';

describe('containFit', () => {
  it('centres a wide image in a square container', () => {
    const fit = containFit({ width: 400, height: 200 }, { width: 200, height: 200 });
    expect(fit).not.toBeNull();
    expect(fit!.scale).toBeCloseTo(0.5);
    expect(fit!.offsetX).toBeCloseTo(0);
    expect(fit!.offsetY).toBeCloseTo(50);
  });

  it('centres a tall image in a square container', () => {
    const fit = containFit({ width: 200, height: 400 }, { width: 200, height: 200 });
    expect(fit!.scale).toBeCloseTo(0.5);
    expect(fit!.offsetX).toBeCloseTo(50);
    expect(fit!.offsetY).toBeCloseTo(0);
  });

  it('returns null until both rectangles are measured', () => {
    expect(containFit(null, { width: 100, height: 100 })).toBeNull();
    expect(containFit({ width: 0, height: 0 }, { width: 100, height: 100 })).toBeNull();
    expect(containFit({ width: 100, height: 100 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe('placeBox', () => {
  it('maps a box through the fit', () => {
    const fit = containFit({ width: 400, height: 200 }, { width: 200, height: 200 })!;
    expect(placeBox([100, 50, 200, 150], fit)).toEqual({
      left: 50,
      top: 75,
      width: 50,
      height: 50,
    });
  });

  /**
   * The regression this file exists for.
   *
   * A hand photographed as a thin strip across a tall frame: the tiles occupy
   * a band in the middle and touch none of the edges. Sizing the fit from the
   * extent of the boxes - as the review overlay once did - reports the image as
   * 900x600 when it is really 900x1600, and every box is then drawn low and too
   * large. Using the real image size keeps them on the tiles.
   */
  it('places a mid-frame strip correctly in a tall photograph', () => {
    const container = { width: 300, height: 300 };
    const realImage = { width: 900, height: 1600 };
    const tileBox: [number, number, number, number] = [300, 500, 400, 600];

    const correct = placeBox(tileBox, containFit(realImage, container)!);

    // What the old code did: infer the source from where the boxes end.
    const inferredFromBoxes = { width: 400, height: 600 };
    const wrong = placeBox(tileBox, containFit(inferredFromBoxes, container)!);

    // The tile sits above the middle of the frame, so it must render in the
    // upper half of the container.
    expect(correct.top).toBeLessThan(container.height / 2);
    // The old behaviour pushed it well past that.
    expect(wrong.top).toBeGreaterThan(correct.top + 50);
    expect(wrong.width).toBeGreaterThan(correct.width * 2);
  });
});
