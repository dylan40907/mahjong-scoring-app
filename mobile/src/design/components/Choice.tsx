import React, { useState } from 'react';
import { Pressable, StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';
import { CaptionStrong, Caption } from './Text';
import { ChevronDownIcon, ChevronRightIcon } from '../icons';
import { colors, radius, space } from '../tokens';

/**
 * Picking things by picture.
 *
 * These replace a column of labelled switches, each with a sentence under it
 * explaining what the label meant. That pattern reads as a tax form, and its
 * words were the worst words in the app: every one of them - kong, meld,
 * self-draw, robbing a kong - is a translation somebody invented, and none is
 * what a player calls it at their own table. Somebody who has played mahjong
 * their whole life in another language could fail to fill in this screen.
 *
 * A drawing of the situation carries across languages in a way the label
 * never did, so the drawing is the control and the words are a caption on it.
 * Laying them out as a grid also makes the whole set visible at once instead
 * of scrolling, which is what made it feel long.
 */

/** Space between cards. Spent as padding inside each cell, not as a gap. */
const GUTTER = space.sm;

export interface ChoiceItem {
  key: string;
  /** One or two words. The picture is doing the explaining. */
  label: string;
  /** Takes the colour so the drawing can answer the selection, not just the border. */
  icon?: (color: ColorValue) => React.ReactNode;
  selected?: boolean;
  onPress: () => void;
}

export interface ChoiceGridProps {
  items: readonly ChoiceItem[];
  /** Three across for short labels, two when they need the room. */
  columns?: 2 | 3;
  style?: ViewStyle;
}

export function ChoiceGrid({ items, columns = 3, style }: ChoiceGridProps) {
  /*
   * Cells take an exact fraction of the width and hold the gutter as padding,
   * with the grid pulled out by half a gutter so the outer edges still line up.
   *
   * The obvious version - `gap` on the grid and a percentage width on each
   * card - does not work: a percentage is measured against the full container,
   * so three 33.3% cards plus two gaps overflow and the third wraps onto its
   * own line. That is why this arrived on the phone as two across when it had
   * looked like three in a wider preview.
   */
  const cell: ViewStyle = { width: `${100 / columns}%`, padding: GUTTER / 2 };

  return (
    <View style={[styles.grid, style]}>
      {items.map((item) => (
        <View key={item.key} style={cell}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !!item.selected }}
            accessibilityLabel={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.card,
              item.selected && styles.cardOn,
              pressed && styles.pressed,
            ]}
          >
            {item.icon ? (
              <View style={styles.cardIcon}>
                {item.icon(item.selected ? colors.brass : colors.inkMuted)}
              </View>
            ) : null}
            {/*
              * Wraps to as many lines as it needs. These labels are already as
              * short as they can be without becoming riddles, and a card
              * reading "Robbed a…" would be worse than a taller card.
              */}
            <CaptionStrong tone={item.selected ? 'accent' : 'muted'} center>
              {item.label}
            </CaptionStrong>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export interface ExpanderProps {
  title: string;
  /** Right-hand summary, so a closed expander still says what is inside it. */
  note?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A section that stays shut until it is wanted.
 *
 * Everything behind one of these is real and occasionally decisive, and none
 * of it applies to the ordinary hand. Showing all of it on every hand made the
 * common path - somebody won, photograph it - the hardest thing on the screen
 * to find.
 */
export function Expander({ title, note, icon, defaultOpen = false, children }: ExpanderProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.expander}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.expanderHead, pressed && styles.pressed]}
      >
        {icon ? <View style={styles.expanderIcon}>{icon}</View> : null}
        <CaptionStrong style={styles.expanderTitle}>{title}</CaptionStrong>
        {note ? <Caption tone="accent">{note}</Caption> : null}
        {open ? (
          <ChevronDownIcon size={18} color={colors.inkFaint} />
        ) : (
          <ChevronRightIcon size={18} color={colors.inkFaint} />
        )}
      </Pressable>
      {open ? <View style={styles.expanderBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -GUTTER / 2 },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    minHeight: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardOn: { borderColor: colors.brass, backgroundColor: colors.brassWash },
  cardIcon: { height: 26, justifyContent: 'center' },
  pressed: { opacity: 0.7 },

  expander: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  expanderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  expanderIcon: { width: 18, alignItems: 'center' },
  expanderTitle: { flex: 1 },
  expanderBody: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
  },
});
