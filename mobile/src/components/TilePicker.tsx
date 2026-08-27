import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, CaptionStrong, Overline, TileFace } from '@/design/components';
import { CloseIcon, TrashIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TILES, type TileCode, type TileDefinition } from '@/tiles/tileset';

/**
 * The correction sheet.
 *
 * A detector will misread tiles, so the cost of fixing one is a real part of
 * how good the app feels. The model's own runners-up sit at the top, one tap
 * away, because when a tile is wrong the right answer is usually the second
 * guess. The full set is underneath for the times it is not.
 */

export interface TilePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (code: TileCode) => void;
  onRemove?: () => void;
  /** The model's next-best guesses for the tile being corrected. */
  alternatives?: readonly { code: TileCode; confidence: number }[];
  current?: TileCode | null;
  title?: string;
  /** Hide flowers and seasons for rulesets that do not use them. */
  includeBonus?: boolean;
}

const GROUPS: { label: string; test: (tile: TileDefinition) => boolean }[] = [
  { label: 'Characters', test: (t) => t.suit === 'man' },
  { label: 'Circles', test: (t) => t.suit === 'pin' },
  { label: 'Bamboo', test: (t) => t.suit === 'sou' },
  { label: 'Winds & Dragons', test: (t) => t.suit === 'wind' || t.suit === 'dragon' },
  { label: 'Flowers & Seasons', test: (t) => t.suit === 'flower' || t.suit === 'season' },
];

export function TilePicker({
  visible,
  onClose,
  onSelect,
  onRemove,
  alternatives,
  current,
  title = 'Choose a tile',
  includeBonus = true,
}: TilePickerProps) {
  const insets = useSafeAreaInsets();

  const groups = useMemo(
    () =>
      GROUPS.filter((group) => includeBonus || group.label !== 'Flowers & Seasons').map((group) => ({
        label: group.label,
        tiles: TILES.filter(group.test),
      })),
    [includeBonus],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.header}>
          <Body>{title}</Body>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <CloseIcon size={20} color={colors.inkMuted} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {alternatives && alternatives.length > 0 ? (
            <View style={styles.section}>
              <Overline>ALSO LIKELY</Overline>
              <View style={styles.alternatives}>
                {alternatives.map((alternative) => (
                  <Pressable
                    key={alternative.code}
                    accessibilityRole="button"
                    onPress={() => onSelect(alternative.code)}
                    style={({ pressed }) => [styles.alternative, pressed && styles.pressed]}
                  >
                    <TileFace code={alternative.code} width={tileSize.md} />
                    <CaptionStrong tone="faint" numeric>
                      {Math.round(alternative.confidence * 100)}%
                    </CaptionStrong>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {groups.map((group) => (
            <View key={group.label} style={styles.section}>
              <Overline>{group.label.toUpperCase()}</Overline>
              <View style={styles.grid}>
                {group.tiles.map((tile) => (
                  <TileFace
                    key={tile.code}
                    code={tile.code}
                    width={tileSize.lg}
                    selected={tile.code === current}
                    onPress={() => onSelect(tile.code)}
                    accessibilityLabel={tile.label}
                  />
                ))}
              </View>
            </View>
          ))}

          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRemove}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <TrashIcon size={18} color={colors.loss} />
              <Body tone="loss">Remove this tile</Body>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.ground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  body: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl },
  section: { marginBottom: space.xl, gap: space.md },
  alternatives: { flexDirection: 'row', gap: space.lg },
  alternative: { alignItems: 'center', gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pressed: { opacity: 0.65 },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
