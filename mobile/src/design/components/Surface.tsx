import React from 'react';
import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../tokens';
import { Body, Caption, Overline } from './Text';
import { ChevronRightIcon } from '../icons';

/**
 * Grouping without nesting.
 *
 * Cards inside cards inside cards is the other reliable tell of a
 * machine-assembled interface: every block gets a container because a
 * container is always defensible. Here a `Section` groups with a label and
 * whitespace and draws no box at all, and `Panel` - the only thing that draws
 * one - is reserved for content that is itself a single interactive unit.
 * Nothing in this app puts a Panel inside a Panel.
 */

export interface SectionProps extends ViewProps {
  title?: string;
  /** Right-aligned note beside the title. */
  note?: string;
  first?: boolean;
}

export function Section({ title, note, first, style, children, ...rest }: SectionProps) {
  return (
    <View style={[first ? styles.sectionFirst : styles.section, style]} {...rest}>
      {title ? (
        <View style={styles.sectionHeader}>
          <Overline>{title.toUpperCase()}</Overline>
          {note ? <Caption tone="faint">{note}</Caption> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface PanelProps extends ViewProps {
  /** Removes the horizontal padding, for edge-to-edge rows inside. */
  flush?: boolean;
}

export function Panel({ flush, style, children, ...rest }: PanelProps) {
  return (
    <View style={[styles.panel, flush && styles.panelFlush, style]} {...rest}>
      {children}
    </View>
  );
}

/** A hairline between rows, inset to align with row text. */
export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

export interface RowProps {
  title: string;
  subtitle?: string;
  /** Right-hand value text. */
  value?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Show a chevron. Implied by onPress unless trailing is given. */
  chevron?: boolean;
  destructive?: boolean;
  style?: ViewStyle;
}

export function Row({
  title,
  subtitle,
  value,
  leading,
  trailing,
  onPress,
  chevron,
  destructive,
  style,
}: RowProps) {
  const showChevron = chevron ?? (!!onPress && !trailing);

  const content = (
    <>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={styles.rowBody}>
        <Body tone={destructive ? 'loss' : 'default'} numberOfLines={1}>
          {title}
        </Body>
        {subtitle ? (
          <Caption tone="faint" numberOfLines={2} style={styles.rowSubtitle}>
            {subtitle}
          </Caption>
        ) : null}
      </View>
      {value ? (
        <Body tone="muted" numeric style={styles.rowValue}>
          {value}
        </Body>
      ) : null}
      {trailing}
      {showChevron ? <ChevronRightIcon size={18} color={colors.inkFaint} /> : null}
    </>
  );

  if (!onPress) return <View style={[styles.row, style]}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xxxl },
  sectionFirst: { marginTop: space.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.md,
    paddingHorizontal: space.xs,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  panelFlush: { paddingHorizontal: 0, paddingVertical: 0 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowPressed: { backgroundColor: colors.surfaceHigh },
  rowLeading: { width: 26, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowSubtitle: { marginTop: 1 },
  rowValue: { marginLeft: space.sm },
});
