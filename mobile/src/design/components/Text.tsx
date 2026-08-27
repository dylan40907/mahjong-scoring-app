import React from 'react';
import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { colors, tabular, type } from '../tokens';

/**
 * Typography as named roles rather than ad-hoc sizes.
 *
 * Every piece of text in the app picks one of these. Nothing sets a fontSize
 * inline, which is what keeps the scale from drifting into eleven slightly
 * different sizes.
 */

type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'gain' | 'loss' | 'onAccent';

const toneColor: Record<Tone, string> = {
  default: colors.ink,
  muted: colors.inkMuted,
  faint: colors.inkFaint,
  accent: colors.brass,
  gain: colors.gain,
  loss: colors.loss,
  onAccent: colors.onBrass,
};

export interface TextProps extends RNTextProps {
  tone?: Tone;
  /** Lining figures that hold their width as a number changes. */
  numeric?: boolean;
  center?: boolean;
}

function make(variant: keyof typeof type, defaultTone: Tone = 'default') {
  return function Styled({ tone = defaultTone, numeric, center, style, ...rest }: TextProps) {
    return (
      <RNText
        {...rest}
        style={[
          type[variant] as object,
          { color: toneColor[tone] },
          numeric ? tabular : null,
          center ? styles.center : null,
          style,
        ]}
      />
    );
  };
}

export const Display = make('display');
export const Title = make('title');
export const Heading = make('heading');
export const Body = make('body');
export const BodyStrong = make('bodyStrong');
export const Caption = make('caption', 'muted');
export const CaptionStrong = make('captionStrong', 'muted');
export const Overline = make('overline', 'faint');

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
