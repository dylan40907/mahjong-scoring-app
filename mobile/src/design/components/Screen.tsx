import React from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../tokens';
import { Backdrop, type Motif } from '../Backdrop';

/**
 * The page frame.
 *
 * Handles the ground, the backdrop and the safe area in one place so no screen
 * has to think about any of them. `scroll` is opt-in rather than default:
 * screens that fit should not bounce.
 */
export interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Extra bottom padding for a fixed action bar. */
  footerSpace?: number;
  /** Horizontal padding. Set false for edge-to-edge lists. */
  padded?: boolean;
  /**
   * What sits behind the content.
   *
   * Defaults to the wash alone, because most screens are lists and a list does
   * not need a mark behind it. The dragon is for the two screens that are
   * about a win.
   */
  motif?: Motif;
  /**
   * The screen's own header, drawn above the content and outside its
   * horizontal padding.
   *
   * A slot rather than each screen laying one out, because the header has to
   * sit edge-to-edge while the content is inset - and every screen that solved
   * that itself solved it slightly differently. Pass a `PageHeader`; the
   * safe-area inset is its business, not this one's.
   */
  header?: React.ReactNode;
}

export function Screen({
  scroll = false,
  footerSpace = 0,
  padded = true,
  motif = 'none',
  header,
  style,
  children,
  ...rest
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingHorizontal: padded ? space.xl : 0,
    paddingBottom: insets.bottom + footerSpace + space.xl,
  };

  if (scroll) {
    return (
      <View style={[styles.root, style]} {...rest}>
        <Backdrop motif={motif} />
        {header}
        <ScrollView
          contentContainerStyle={padding}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, style]} {...rest}>
      <Backdrop motif={motif} />
      {header}
      {/* The padding moves to an inner view so the backdrop can reach the
          edges while the content still sits inside the safe area. */}
      <View style={[styles.body, padding]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  body: { flex: 1 },
});
