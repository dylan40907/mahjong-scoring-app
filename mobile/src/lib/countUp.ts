/**
 * The arithmetic behind a number that counts up to its value.
 *
 * Separated from the component because the interesting part is not the
 * animation, it is the rounding: a score that ticks 0, 3, 7, 10 has to land
 * exactly on its target and must never overshoot it, and a settlement that
 * counts *down* has to do the same in the other direction. Both are easy to get
 * subtly wrong and impossible to see in a screenshot.
 */

/**
 * Ease-out cubic: quick at first, settling at the end.
 *
 * The shape matters for a score. Linear reads as a progress bar, and something
 * that accelerates reads as though it might keep going; a number that rushes
 * out and settles reads as arriving at an answer.
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * The value to show `elapsed` into a count from `from` to `to`.
 *
 * Rounds toward the target rather than to nearest, so the last frame before
 * completion never displays a number past it - counting to 7 must not flash 8.
 */
export function countUpValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  if (elapsed <= 0) return from;

  const raw = from + (to - from) * easeOutCubic(elapsed / duration);
  return to >= from ? Math.floor(raw) : Math.ceil(raw);
}

/**
 * How long a count should take.
 *
 * Tied to distance so a two-point hand does not take as long as a
 * hundred-and-seventy-point one, and clamped at both ends: below about a fifth
 * of a second nothing registers, and past a second the animation is in the way
 * of the number it is showing.
 */
export function countUpDuration(distance: number): number {
  const magnitude = Math.abs(distance);
  if (magnitude === 0) return 0;
  return Math.round(Math.max(220, Math.min(900, 180 + magnitude * 9)));
}
