import React, { useEffect, useRef, useState } from 'react';
import { Display, Title, CaptionStrong } from './Text';
import { countUpDuration, countUpValue } from '@/lib/countUp';

/**
 * A number that arrives rather than appears.
 *
 * Used for the score a hand is worth and for what each player pays. The point
 * is not decoration: a settlement is four numbers changing at once, and
 * watching them move is how you see who gained and who paid without reading
 * four lines. It also buys the moment of suspense that scoring a hand deserves
 * and otherwise does not get.
 *
 * Driven by requestAnimationFrame rather than by Reanimated, because the thing
 * being animated is the *text*, and Reanimated animates styles on the UI
 * thread - getting a number out of it and back into a Text node costs a bridge
 * hop per frame for no benefit at these durations.
 */

type Variant = 'display' | 'title' | 'caption';

interface Props {
  value: number;
  /** Prefix a positive number with "+", as a score movement wants. */
  signed?: boolean;
  variant?: Variant;
  tone?: 'accent' | 'gain' | 'loss' | 'muted' | 'faint' | 'default';
  suffix?: string;
  /** Skip the animation; used when the value updates rather than arrives. */
  instant?: boolean;
}

export function CountUp({
  value,
  signed = false,
  variant = 'title',
  tone,
  suffix,
  instant = false,
}: Props) {
  /*
   * `null` means "not counting", and the value is shown as it is. Deciding
   * that in a lazy initialiser rather than in the effect is what keeps the
   * effect from setting state synchronously, which would cascade a render on
   * every mount for a number that was never going to move.
   */
  const [counting, setCounting] = useState<number | null>(() =>
    instant || countUpDuration(value) === 0 ? null : 0,
  );
  const frame = useRef<number | null>(null);
  /*
   * Where the next count starts from.
   *
   * Zero on mount, so a score revealed for the first time climbs from nothing.
   * The settled value afterwards, so a running total that changes moves *from
   * where it was* - a player going 170 to 250 should count the eighty they
   * gained, not restart from zero as though the session had.
   */
  const previous = useRef(0);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    const duration = instant ? 0 : countUpDuration(value - from);
    if (duration === 0) return;

    const started = Date.now();
    const step = () => {
      const elapsed = Date.now() - started;
      // Only ever inside the frame callback, never synchronously in the effect.
      setCounting(elapsed >= duration ? null : countUpValue(from, value, elapsed, duration));
      if (elapsed < duration) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, instant]);

  const shown = counting ?? value;

  const text = `${signed && shown > 0 ? '+' : ''}${shown}${suffix ? ` ${suffix}` : ''}`;
  const Component = variant === 'display' ? Display : variant === 'caption' ? CaptionStrong : Title;

  // The finished value is what a screen reader should hear; the intermediate
  // frames are noise to anyone not watching them.
  const settled = `${signed && value > 0 ? '+' : ''}${value}${suffix ? ` ${suffix}` : ''}`;
  return (
    <Component tone={tone} numeric accessibilityLabel={settled}>
      {text}
    </Component>
  );
}
