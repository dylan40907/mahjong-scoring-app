import React from 'react';
import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { colors, hairline, radius, space } from '../tokens';
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
  /**
   * A mark beside the heading.
   *
   * Only worth having when it is drawn from the game - a wind rose, a flower,
   * three tiles set down. A generic glyph next to a section label says "this
   * is a section" twice, which the label already said once.
   */
  icon?: React.ReactNode;
  /** Right-aligned note beside the title. */
  note?: string;
  first?: boolean;
}

export function Section({ title, icon, note, first, style, children, ...rest }: SectionProps) {
  return (
    <View style={[first ? styles.sectionFirst : styles.section, style]} {...rest}>
      {title ? (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitle}>
            {icon ? <View style={styles.sectionIcon}>{icon}</View> : null}
            <Overline>{title.toUpperCase()}</Overline>
          </View>
          {/*
            * A rule running out from the label to the right margin.
            *
            * Section headings were small capitals floating in space, which
            * gave the page no structure to hang on - the eye had no line to
            * follow from a heading to the thing it named. A hairline does that
            * for the cost of one view, and it is the same device a scoresheet
            * uses.
            */}
          <View style={styles.sectionRule} />
          {note ? <Caption tone="faint">{note}</Caption> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface FieldProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * A labelled control that sits *below* its label rather than beside it.
 *
 * `Row` puts the control on the right, which works for a stepper and fails for
 * anything that wants the whole width. A `Segmented` sizes itself entirely
 * from its children's `flex: 1`, so in a row it has no width to divide up: on
 * a phone the label vanished and the row grew to most of a screen, leaving one
 * pair of buttons floating in an empty panel.
 */
export function Field({ title, subtitle, children, style }: FieldProps) {
  return (
    <View style={[styles.field, style]}>
      <View style={styles.fieldLabel}>
        <Body>{title}</Body>
        {subtitle ? <Caption tone="faint">{subtitle}</Caption> : null}
      </View>
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
        {/* Wraps, like the subtitle. "Discards before the win" arrived as
            "Discards b…" next to a stepper, which is exactly the ellipsis with
            no way to open it that this app is not supposed to have. */}
        <Body tone={destructive ? 'loss' : 'default'}>{title}</Body>
        {/* Wraps. A hint that ends in an ellipsis with no way to open it is
            worse than no hint, and every one of these is short enough to
            simply fit. */}
        {subtitle ? (
          <Caption tone="faint" style={styles.rowSubtitle}>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
    paddingHorizontal: space.xs,
  },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionIcon: { opacity: 0.9 },
  sectionRule: {
    flex: 1,
    height: hairline,
    marginLeft: space.md,
    marginRight: space.sm,
    backgroundColor: colors.line,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    /*
     * A lighter line along the top edge only, which is what a raised surface
     * does under a light source and what a border of one flat colour on all
     * four sides never did. It is the difference between a panel that looks
     * cut out of the background and one that looks laid on top of it, and it
     * costs a colour rather than a shadow - shadows are still reserved for the
     * two things genuinely lifted off the page.
     */
    borderTopColor: colors.lineStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  panelFlush: { paddingHorizontal: 0, paddingVertical: 0 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Aligns a wrapping subtitle with its title rather than centring the whole
    // block against a one-line trailing control.
    alignSelf: 'stretch',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowPressed: { backgroundColor: colors.surfaceHigh },
  field: {
    alignSelf: 'stretch',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  fieldLabel: { gap: 2 },
  rowLeading: { width: 26, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowSubtitle: { marginTop: 1 },
  rowValue: { marginLeft: space.sm },
});
