import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Caption } from './Text';
import { TileFace } from './Tile';
import { colors, radius, space } from '../tokens';
import type { TileCode } from '@/tiles/tileset';

/**
 * What the app does while it is reading a photograph.
 *
 * Inference takes a beat - decode, detect, classify - and a spinner would say
 * only "something is happening". Showing tiles with a line passing over them
 * says *which* something, which is the difference between waiting and watching.
 * It also sets the right expectation: the app is looking at tiles, so a
 * photograph of something else will not work.
 *
 * The tiles are fixed rather than random. A sequence that changes every time
 * reads as decoration; one that does not reads as a machine doing a job.
 */

const SAMPLE: TileCode[] = ['man1', 'pin5', 'sou9', 'east'];
const TILE_WIDTH = 34;
const SWEEP_MS = 1400;

export function TileScanner({ label }: { label: string }) {
  const sweep = useSharedValue(0);
  const glow = useSharedValue(0.3);

  useEffect(() => {
    sweep.value = withRepeat(
      withSequence(
        withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic) }),
        withDelay(160, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withTiming(0.75, { duration: SWEEP_MS / 2, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(glow);
    };
  }, [sweep, glow]);

  const height = Math.round(TILE_WIDTH * (4 / 3));

  const line = useAnimatedStyle(() => ({
    // Travels a little past both edges so it enters and leaves rather than
    // appearing at the top and vanishing at the bottom.
    transform: [{ translateY: -6 + sweep.value * (height + 12) }],
    opacity: glow.value,
  }));

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label}>
      <View style={styles.stage}>
        <View style={styles.tiles}>
          {SAMPLE.map((code) => (
            <TileFace key={code} code={code} width={TILE_WIDTH} />
          ))}
        </View>
        <Animated.View style={[styles.line, line]} pointerEvents="none" />
      </View>
      <Caption tone="muted">{label}</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.sm },
  stage: {
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.well,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  tiles: { flexDirection: 'row', gap: space.xs },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.brass,
  },
});
