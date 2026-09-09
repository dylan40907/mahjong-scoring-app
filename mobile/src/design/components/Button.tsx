import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius, space, type } from '../tokens';
import { BodyStrong } from './Text';

/**
 * Three button weights and no more.
 *
 * `primary` is the one brass element on a screen and there is at most one of
 * them visible at a time. `secondary` is a bordered neutral. `ghost` is text
 * with a touch target. A fourth weight would only exist to avoid deciding
 * which of these a button is.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  /**
   * Sign in with Apple, in the only shape Apple permits.
   *
   * White with a black wordmark, matched to the sheet it opens. Apple's
   * Human Interface Guidelines are prescriptive about this button and a jade
   * one with brass text would fail review.
   */
  | 'apple'
  /**
   * Sign in with somebody else, alongside Apple's.
   *
   * Also white, because a provider button has to look like the provider's
   * rather than like ours. Brass is this app's primary action - it means
   * "the thing this screen is for" - and putting Google on it made the button
   * read as an advertisement for Tile Tally that happened to mention Google,
   * sitting oddly beside Apple's white one directly above.
   */
  | 'provider';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  /** Fill the available width. */
  block?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  icon,
  block,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variants[variant].container,
        block && styles.block,
        pressed && !isDisabled && variants[variant].pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={SPINNER[variant] ?? colors.ink} />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <BodyStrong tone={variants[variant].tone} style={styles.label}>
            {label}
          </BodyStrong>
        </View>
      )}
    </Pressable>
  );
}

/** The spinner has to be legible on whatever the button is filled with. */
const SPINNER: Partial<Record<ButtonVariant, string>> = {
  primary: colors.onBrass,
  apple: '#000000',
  provider: '#000000',
};

const variants = {
  primary: {
    container: { backgroundColor: colors.brass },
    pressed: { backgroundColor: colors.brassDim },
    tone: 'onAccent' as const,
  },
  secondary: {
    container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    pressed: { backgroundColor: colors.surfaceHigh },
    tone: 'default' as const,
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    pressed: { backgroundColor: colors.surface },
    tone: 'muted' as const,
  },
  danger: {
    container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
    pressed: { backgroundColor: colors.surface },
    tone: 'loss' as const,
  },
  apple: {
    container: { backgroundColor: '#FFFFFF' },
    pressed: { backgroundColor: '#E4E4E4' },
    tone: 'onLight' as const,
  },
  provider: {
    container: { backgroundColor: '#FFFFFF' },
    pressed: { backgroundColor: '#E4E4E4' },
    tone: 'onLight' as const,
  },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  icon: { marginLeft: -space.xs },
  label: { ...type.bodyStrong },
  disabled: { opacity: 0.38 },
});
