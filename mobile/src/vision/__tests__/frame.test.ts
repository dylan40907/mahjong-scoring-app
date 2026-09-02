import { CAPTURE_ASPECT, frameCrop } from '../frame';

describe('frameCrop', () => {
  it('takes a centred band out of a portrait sensor image', () => {
    // 4:3 held landscape is narrower than the frame, so height is what goes.
    const rect = frameCrop(4000, 3000, 2)!;
    expect(rect).toEqual({ originX: 0, originY: 500, width: 4000, height: 2000 });
  });

  it('takes a centred column out of something wider than the frame', () => {
    const rect = frameCrop(4000, 1000, 2)!;
    expect(rect).toEqual({ originX: 1000, originY: 0, width: 2000, height: 1000 });
  });

  it('leaves an image that already matches the frame alone', () => {
    expect(frameCrop(2000, 1000, 2)).toBeNull();
  });

  it('refuses to work on a size it does not have', () => {
    expect(frameCrop(0, 0, 2)).toBeNull();
    expect(frameCrop(100, 100, 0)).toBeNull();
  });

  it('produces the frame aspect it was asked for', () => {
    const rect = frameCrop(4032, 3024, CAPTURE_ASPECT)!;
    expect(rect.width / rect.height).toBeCloseTo(CAPTURE_ASPECT, 2);
  });
});
