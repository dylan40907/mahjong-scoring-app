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
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

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
        <ActivityIndicator size="small" color={variant === 'primary' ? colors.onBrass : colors.ink} />
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
