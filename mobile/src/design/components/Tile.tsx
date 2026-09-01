import React from 'react';
import { Image, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import type { TileCode } from '@/tiles/tileset';
import { TILE_IMAGES } from '@/tiles/assets';
import { colors, space, tileHeight } from '../tokens';
import { Caption } from './Text';

/**
 * A tile face.
 *
 * Rendered from pre-rasterised PNGs rather than vector art. The faces are
 * generated once from a CC0 SVG set at a resolution well above any display
 * size, which keeps them crisp without a runtime SVG parser on the critical
 * path of a screen that draws seventeen of them at once.
 *
 * The 3:4 aspect is derived, never passed in, so a tile is the same shape
 * everywhere it appears.
 */

export interface TileFaceProps {
  code: TileCode;
  width: number;
  onPress?: () => void;
  /** Hold to pick a tile up; used by the hand row to start a drag. */
  onLongPress?: () => void;
  /** Draws the brass selection ring. */
  selected?: boolean;
  /** Dims the face; used for tiles the model was unsure about. */
  uncertain?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function TileFace({
  code,
  width,
  onPress,
  onLongPress,
  selected,
  uncertain,
  style,
  accessibilityLabel,
  accessibilityHint,
}: TileFaceProps) {
  const box: ViewStyle = {
    width,
    height: tileHeight(width),
    borderRadius: Math.max(3, Math.round(width * 0.14)),
  };

  const face = (
    <View
      style={[
        styles.face,
        box,
        selected && styles.selected,
        uncertain && styles.uncertain,
        style,
      ]}
    >
      <Image source={TILE_IMAGES[code]} style={styles.image} resizeMode="contain" />
    </View>
  );

  if (!onPress && !onLongPress) return face;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {face}
    </Pressable>
  );
}

/**
 * A hand laid out the way it sits on the table.
 *
 * `groups` keeps melds visually separate, which is how a player reads their
 * own hand - and, not coincidentally, exactly the structure the spatial
 * ordering step recovers from a photograph.
 */
export interface TileRowProps {
  groups: readonly (readonly TileCode[])[];
  width?: number;
  onPressTile?: (groupIndex: number, tileIndex: number) => void;
  selected?: { group: number; tile: number } | null;
  uncertain?: readonly { group: number; tile: number }[];
  style?: ViewStyle;
}

export function TileRow({
  groups,
  width = 40,
  onPressTile,
  selected,
  uncertain = [],
  style,
}: TileRowProps) {
  const isUncertain = (g: number, t: number) =>
    uncertain.some((u) => u.group === g && u.tile === t);

  return (
    <View style={[styles.row, style]}>
      {groups.map((group, groupIndex) => (
        <View key={groupIndex} style={styles.group}>
          {group.map((code, tileIndex) => (
            <TileFace
              key={`${groupIndex}-${tileIndex}-${code}`}
              code={code}
              width={width}
              selected={selected?.group === groupIndex && selected?.tile === tileIndex}
              uncertain={isUncertain(groupIndex, tileIndex)}
              onPress={onPressTile ? () => onPressTile(groupIndex, tileIndex) : undefined}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Placeholder shown where a hand has not been entered yet. */
export function EmptyHand({ count, width = 40 }: { count: number; width?: number }) {
  return (
    <View style={styles.row}>
      <View style={styles.group}>
        {Array.from({ length: count }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.placeholder,
              { width, height: tileHeight(width), borderRadius: Math.round(width * 0.14) },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function TileCount({ count, total }: { count: number; total: number }) {
  const complete = count === total;
  return (
    <Caption tone={complete ? 'muted' : 'loss'} numeric>
      {count} of {total} tiles
    </Caption>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: colors.bone,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },
  image: { width: '100%', height: '100%' },
  selected: { borderColor: colors.brass, borderWidth: 2 },
  uncertain: { opacity: 0.55 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'center' },
  group: { flexDirection: 'row', gap: 2 },
  placeholder: {
    backgroundColor: colors.well,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
});
