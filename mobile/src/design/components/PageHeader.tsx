import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '../icons';
import { Title } from './Text';
import { colors, space } from '../tokens';

/**
 * Every screen's header, so that there is only one of them.
 *
 * This started as a fix for the screens whose title is editable in the page:
 * they could not put it in the navigation bar, so they hid the bar's title and
 * left the bar there, spending a whole row of a phone on one chevron and a
 * word. On the session screen that pushed the standings - the thing people
 * pick the phone up to read - far enough down to need a scroll.
 *
 * It is now the header for all of them, and that is the more important
 * property. The rest of the app was still on the platform's bar, so a back
 * arrow changed shape, weight and position depending on which screen you were
 * on and which phone you held, and an action in the corner was a system button
 * that matched nothing around it. One header means one back arrow.
 *
 * The swipe-back gesture is unaffected - it belongs to the navigator, not to
 * the header - so the arrow is a second way to do something that still works
 * without it.
 */
export interface PageHeaderProps {
  /** The ordinary case: one line of text. */
  title?: string;
  /**
   * For screens whose heading is not just a string - an editable name, a name
   * with a byline under it. Takes the place of `title`.
   */
  children?: React.ReactNode;
  /** An action in the far corner. One, and only where a screen earns it. */
  trailing?: React.ReactNode;
  /**
   * Off for the root of a tab, which has nothing to go back to. A chevron
   * that pops to a screen the tab bar already shows is a second, worse tab
   * bar.
   */
  back?: boolean;
}

export function PageHeader({ title, children, trailing, back = true }: PageHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.row, { paddingTop: insets.top + space.sm }]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          // A generous target around a small glyph: the arrow is drawn at the
          // size it should look, and hit-tested at the size a thumb needs.
          hitSlop={space.md}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={26} color={colors.ink} />
        </Pressable>
      ) : (
        // The same left inset as a screen with a chevron, so titles line up
        // between screens that have one and screens that do not.
        <View style={styles.backSpacer} />
      )}
      <View style={styles.body}>{children ?? (title ? <Title>{title}</Title> : null)}</View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingBottom: space.sm,
    paddingRight: space.lg,
  },
  back: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: { width: space.lg },
  pressed: { opacity: 0.6 },
  body: { flex: 1 },
  trailing: { marginLeft: space.sm },
});
