import React from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../tokens';

/**
 * The page frame.
 *
 * Handles the ground colour and the safe area in one place so no screen has to
 * think about either. `scroll` is opt-in rather than default: screens that fit
 * should not bounce.
 */
export interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Extra bottom padding for a fixed action bar. */
  footerSpace?: number;
  /** Horizontal padding. Set false for edge-to-edge lists. */
  padded?: boolean;
}

export function Screen({
  scroll = false,
  footerSpace = 0,
  padded = true,
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
    <View style={[styles.root, padding, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
