import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../tokens';

/**
 * A small shower of tiles when a hand is scored.
 *
 * Deliberately small. The app is restrained everywhere else, and a screenful of
 * particles would read as a different product; sixteen pieces falling for a
 * second reads as the app noticing that something good happened. It runs once,
 * on arrival, and leaves nothing behind.
 *
 * The pieces are tile-shaped and take their colours from the tile faces - bone,
 * and the red and green of the dragons - rather than from a party palette, so
 * the moment still belongs to this app.
 */

const PIECES = 16;
const FALL_MS = 1100;
const CONFETTI_COLOURS = [colors.bone, colors.brass, colors.gain, colors.loss];

/** Stable pseudo-noise in [0, 1) from two small integers. */
function noise(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

interface Piece {
  x: number;
  delay: number;
  drift: number;
  spin: number;
  colour: string;
  size: number;
}

function Falling({ piece, distance }: { piece: Piece; distance: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      piece.delay,
      // Gravity is closer to ease-in, but a linear fall with a long tail reads
      // better at this size than a physically honest one.
      withTiming(1, { duration: FALL_MS, easing: Easing.out(Easing.quad) }),
    );
    return () => cancelAnimation(progress);
  }, [progress, piece.delay]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.value * distance },
      { translateX: progress.value * piece.drift },
      { rotate: `${progress.value * piece.spin}deg` },
    ],
    // Fades only at the end, so the shower does not look like it is dissolving
    // the whole way down.
    opacity: progress.value < 0.7 ? 1 : 1 - (progress.value - 0.7) / 0.3,
  }));

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: piece.x,
          width: piece.size,
          height: Math.round(piece.size * 1.33),
          backgroundColor: piece.colour,
        },
        style,
      ]}
    />
  );
}

export function Confetti({ active }: { active: boolean }) {
  const { width, height } = useWindowDimensions();

  /*
   * Scattered by a hash of the piece index rather than by Math.random.
   *
   * Randomness during render is not stable - a re-render mid-fall would deal a
   * fresh shower and every piece would jump - and moving it into an effect only
   * trades that for a cascading render. A hash gives the same scattered look
   * with none of that, and a deterministic shower is not a worse one: nobody
   * compares two of them.
   */
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: PIECES }, (_, index) => ({
        x: Math.round((index / PIECES) * width + (noise(index, 1) - 0.5) * 24),
        delay: Math.round(noise(index, 2) * 260),
        drift: Math.round((noise(index, 3) - 0.5) * 90),
        spin: Math.round((noise(index, 4) - 0.5) * 420),
        colour: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
        size: 7 + Math.round(noise(index, 5) * 5),
      })),
    [width],
  );

  if (!active) return null;

  return (
    <View style={styles.layer} pointerEvents="none" accessibilityElementsHidden>
      {pieces.map((piece, index) => (
        <Falling key={index} piece={piece} distance={height * 0.55} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  piece: { position: 'absolute', top: -20, borderRadius: 2 },
});
