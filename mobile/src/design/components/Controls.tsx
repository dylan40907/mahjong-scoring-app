import React from 'react';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../tokens';
import { Body, Caption, CaptionStrong } from './Text';
import { CheckIcon } from '../icons';

/**
 * The small interactive parts: segmented choices, chips, toggles, steppers.
 *
 * All of them share one rule - selection is shown by a filled surface and a
 * change of text weight, never by a colour swatch. Colour stays reserved for
 * the primary action and the score.
 */

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
}

export function Segmented<T extends string>({ options, value, onChange, style }: SegmentedProps<T>) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <CaptionStrong tone={active ? 'default' : 'faint'}>{option.label}</CaptionStrong>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Right-hand value, e.g. a tai count. */
  value?: string;
}

export function Chip({ label, selected, onPress, value }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Caption tone={selected ? 'default' : 'muted'}>{label}</Caption>
      {value ? (
        <CaptionStrong tone={selected ? 'accent' : 'faint'} numeric>
          {value}
        </CaptionStrong>
      ) : null}
    </Pressable>
  );
}

export interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}

/**
 * A checkbox, not a switch.
 *
 * These appear a dozen at a time on the hand-context screen. A column of
 * platform switches at that density reads as a settings dump; a checkmark
 * reads as a list of things that were true about the hand.
 */
export function Toggle({ value, onChange, label, hint }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggle, pressed && styles.chipPressed]}
    >
      <View style={[styles.box, value && styles.boxChecked]}>
        {value ? <CheckIcon size={14} color={colors.onBrass} strokeWidth={2.6} /> : null}
      </View>
      <View style={styles.toggleBody}>
        <Body>{label}</Body>
        {hint ? <Caption tone="faint">{hint}</Caption> : null}
      </View>
    </Pressable>
  );
}

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1 }: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        onPress={() => onChange(clamp(value - step))}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.chipPressed]}
      >
        <Body tone={value <= min ? 'faint' : 'muted'}>−</Body>
      </Pressable>
      <Body numeric style={styles.stepperValue}>
        {value}
      </Body>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase"
        onPress={() => onChange(clamp(value + step))}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.chipPressed]}
      >
        <Body tone={value >= max ? 'faint' : 'muted'}>+</Body>
      </Pressable>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <Body center>{title}</Body>
      <Caption tone="faint" center style={styles.emptyBody}>
        {body}
      </Caption>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.well,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: space.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.surfaceHigh },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.brassDim, backgroundColor: colors.brassWash },
  chipPressed: { opacity: 0.7 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.brass, borderColor: colors.brass },
  toggleBody: { flex: 1, gap: 1 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.well,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepperButton: { width: 38, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 34, textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: space.giant, paddingHorizontal: space.xl },
  emptyIcon: { marginBottom: space.lg, opacity: 0.4 },
  emptyBody: { marginTop: space.xs, maxWidth: 280 },
  emptyAction: { marginTop: space.xl },
});

export interface TextFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  /** Commit on leaving the field, for values saved as you go. */
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  /** Hides what is typed, and stops the keyboard offering to remember it. */
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  /**
   * Off for anything that is a name rather than prose.
   *
   * A keyboard that helpfully turns `wei_88` into `Wei 88` has broken the one
   * field where the characters are the whole value.
   */
  autoCorrect?: boolean;
  style?: ViewStyle;
}

/**
 * A text field that sits *below* the surface rather than on it.
 *
 * Inputs are wells, not cards - the one place in the app where a darker
 * surface appears - which is what tells the eye something is editable without
 * needing a border colour or a focus glow.
 */
export function TextField({
  value,
  onChangeText,
  placeholder,
  label,
  autoFocus,
  maxLength,
  keyboardType = 'default',
  style,
  onBlur,
  onSubmitEditing,
  secureTextEntry,
  autoCapitalize,
  autoCorrect,
}: TextFieldProps) {
  return (
    <View style={style}>
      {label ? <Caption tone="faint" style={fieldStyles.label}>{label}</Caption> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        autoFocus={autoFocus}
        secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize ?? (secureTextEntry || keyboardType === 'email-address' ? 'none' : undefined)}
      autoCorrect={autoCorrect}
      onBlur={onBlur}
      onSubmitEditing={onSubmitEditing}
      maxLength={maxLength}
        keyboardType={keyboardType}
        selectionColor={colors.brass}
        style={fieldStyles.input}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  label: { marginBottom: space.xs, paddingHorizontal: space.xs },
  input: {
    backgroundColor: colors.well,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
    color: colors.ink,
    fontSize: 15,
    letterSpacing: -0.1,
  },
});
