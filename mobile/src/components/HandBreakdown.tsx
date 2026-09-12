import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Overline,
  TileRow,
} from '@/design/components';
import { CloseIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import { signed } from '@/lib/format';
import type { Breakdown } from '@/scoring';
import type { TileCode } from '@/tiles/tileset';
import { HandTiles } from './HandTiles';

/**
 * Everything one hand was worth, opened by tapping it.
 *
 * The list of pattern names that used to run under every hand said what
 * scored and never how much, and it took the space the tiles themselves
 * should have had. Here each line gets its value in the ruleset's own unit
 * and, where particular tiles earned it - the three dragon pungs, the flower
 * that matched the seat - those tiles under its name. Lines about the hand as
 * a whole, or about how it was won, have nothing to point at and show the
 * words alone.
 *
 * The payments close it, because they answer the question the total raises:
 * what this actually cost everybody at the table.
 */

export interface HandSheet {
  readonly title: string;
  readonly subtitle?: string;
  readonly groups: readonly (readonly TileCode[])[] | null;
  readonly tiles: readonly TileCode[];
  /** Null when it cannot be worked out here - somebody else's own ruleset. */
  readonly breakdown: Breakdown | null;
  /** What to say instead, from what was saved with the hand. */
  readonly fallback?: { readonly total: string; readonly patterns: readonly string[] };
  readonly payments?: readonly { readonly name: string; readonly amount: number }[];
}

export function HandBreakdown({
  visible,
  sheet,
  onClose,
  action,
}: {
  visible: boolean;
  /** Kept by the caller after closing, so it does not blank as it slides away. */
  sheet: HandSheet | null;
  onClose: () => void;
  /** At most one, for the owner: correcting the hand. */
  action?: { label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible && !!sheet} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {sheet ? (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Body>{sheet.title}</Body>
              {sheet.subtitle ? <Caption tone="faint">{sheet.subtitle}</Caption> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={12}
            >
              <CloseIcon size={20} color={colors.inkMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <HandTiles groups={sheet.groups} tiles={sheet.tiles} />

            <View style={styles.section}>
              <Overline>HOW IT SCORED</Overline>
              <View style={styles.lines}>
                {sheet.breakdown ? (
                  sheet.breakdown.lines.map((line, index) => (
                    <View key={`${line.id}-${index}`}>
                      {index > 0 ? <Divider /> : null}
                      <View style={styles.line}>
                        <View style={styles.lineText}>
                          <BodyStrong>{line.name}</BodyStrong>
                          {line.tiles ? <TileRow groups={line.tiles} width={22} /> : null}
                        </View>
                        <CaptionStrong tone="accent" numeric style={styles.amount}>
                          {line.amount}
                        </CaptionStrong>
                      </View>
                    </View>
                  ))
                ) : (
                  // Names without values, from what was saved with the hand.
                  (sheet.fallback?.patterns ?? []).map((name, index) => (
                    <View key={`${name}-${index}`}>
                      {index > 0 ? <Divider /> : null}
                      <View style={styles.line}>
                        <BodyStrong style={styles.lineText}>{name}</BodyStrong>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.total}>
                <BodyStrong>Total</BodyStrong>
                <BodyStrong tone="accent" numeric>
                  {sheet.breakdown?.total ?? sheet.fallback?.total ?? ''}
                </BodyStrong>
              </View>
              {sheet.breakdown?.note ? (
                <Caption tone="faint">{sheet.breakdown.note}</Caption>
              ) : null}
            </View>

            {sheet.payments && sheet.payments.length > 0 ? (
              <View style={styles.section}>
                <Overline>PAID</Overline>
                <View style={styles.lines}>
                  {sheet.payments.map((payment, index) => (
                    <View key={`${payment.name}-${index}`}>
                      {index > 0 ? <Divider /> : null}
                      <View style={styles.line}>
                        <Body style={styles.lineText}>{payment.name}</Body>
                        <CaptionStrong
                          numeric
                          tone={payment.amount > 0 ? 'gain' : payment.amount < 0 ? 'loss' : 'faint'}
                        >
                          {signed(payment.amount)}
                        </CaptionStrong>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {action ? <Button label={action.label} block onPress={action.onPress} /> : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '86%',
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
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerText: { flex: 1, gap: 2 },
  body: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl, gap: space.xl },
  section: { gap: space.md },
  lines: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  lineText: { flex: 1, gap: space.sm },
  amount: { paddingTop: 2 },
  total: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
});
