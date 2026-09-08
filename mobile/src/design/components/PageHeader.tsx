import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '../icons';
import { colors, space } from '../tokens';

/**
 * A back arrow on the same line as the title.
 *
 * The screens whose title is editable in the page could not put it in the
 * navigation bar, so they hid the bar's title and left the bar there - which
 * spent a whole row of a phone screen on one chevron and a word. On the
 * session screen that pushed the table down far enough that the standings, the
 * thing people pick the phone up to read, needed a scroll.
 *
 * So the bar goes and this takes its place: the same chevron, on the same line
 * as the name, with the name still tappable to rename. The swipe-back gesture
 * is unaffected - it belongs to the navigator, not to the header - so the
 * arrow is a second way to do something that still works without it.
 *
 * `children` rather than a title string because every screen using this has a
 * different thing to put there: an editable name, a name with a byline under
 * it. The chevron is the only part that is always the same.
 */
export function PageHeader({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.row, { paddingTop: insets.top + space.sm }]}>
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
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingBottom: space.sm,
    paddingRight: space.xl,
  },
  back: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1 },
});
