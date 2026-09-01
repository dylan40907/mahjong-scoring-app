import { countUpDuration, countUpValue, easeOutCubic } from '../countUp';

describe('easeOutCubic', () => {
  it('runs from 0 to 1 and clamps outside', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('is ahead of linear throughout, which is what "ease out" means', () => {
    for (const t of [0.15, 0.3, 0.5, 0.75, 0.9]) {
      expect(easeOutCubic(t)).toBeGreaterThan(t);
    }
  });
});

describe('countUpValue', () => {
  it('starts at the start and ends exactly on the target', () => {
    expect(countUpValue(0, 7, 0, 500)).toBe(0);
    expect(countUpValue(0, 7, 500, 500)).toBe(7);
    expect(countUpValue(0, 7, 900, 500)).toBe(7);
  });

  it('never overshoots while counting up', () => {
    for (let elapsed = 0; elapsed <= 500; elapsed += 5) {
      const value = countUpValue(0, 7, elapsed, 500);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('never overshoots while counting down', () => {
    for (let elapsed = 0; elapsed <= 500; elapsed += 5) {
      const value = countUpValue(0, -300, elapsed, 500);
      expect(value).toBeLessThanOrEqual(0);
      expect(value).toBeGreaterThanOrEqual(-300);
    }
    expect(countUpValue(0, -300, 500, 500)).toBe(-300);
  });

  it('is monotonic in both directions', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= 600; elapsed += 10) {
      const value = countUpValue(0, 170, elapsed, 600);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('handles a zero-length count', () => {
    expect(countUpValue(0, 5, 0, 0)).toBe(5);
  });
});

describe('countUpDuration', () => {
  it('is nothing for no movement', () => {
    expect(countUpDuration(0)).toBe(0);
  });

  it('grows with distance but stays within the bounds', () => {
    expect(countUpDuration(1)).toBeGreaterThanOrEqual(220);
    expect(countUpDuration(5)).toBeLessThan(countUpDuration(80));
    expect(countUpDuration(100000)).toBeLessThanOrEqual(900);
  });

  it('does not care about direction', () => {
    expect(countUpDuration(-170)).toBe(countUpDuration(170));
  });
});
