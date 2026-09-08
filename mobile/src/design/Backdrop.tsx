import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Rect,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { colors } from './tokens';

/**
 * The ground plane, which used to be one flat colour on every screen.
 *
 * That flatness was the single biggest thing making the app look unfinished.
 * Every screen was the same jade rectangle with panels pasted on it, so
 * nothing had a light source, nothing had a horizon, and no screen looked like
 * it was about anything in particular. Panels can only read as raised if there
 * is something for them to be raised *off*.
 *
 * Two layers do the work, and both are deliberately almost invisible:
 *
 *   A wash. A soft pool of light near the top falling away to a deeper floor,
 *   which is what a table lit from above actually looks like and what gives
 *   the eye a top and a bottom.
 *
 *   A motif, drawn from the game and bled off an edge so it reads as texture
 *   rather than as a logo somebody centred. At three or four percent opacity
 *   it is not something you look at; it is the reason the corner of the screen
 *   is not empty.
 *
 * This is the one place the "no gradients" rule is relaxed, and the exception
 * is about *where* rather than about degree: gradients belong to the ground and
 * never to a component. The original rule exists so that panels, buttons and
 * rows stay flat and honest instead of each looking lit from within, and that
 * still holds - nothing here touches a surface.
 *
 * All of it is `react-native-svg`, which the icons already use, so the whole
 * visual pass ships over the air instead of needing a build.
 */

export type Motif =
  /** Utility screens. The wash and nothing else. */
  | 'none'
  /**
   * 中, the red dragon, set on the diagonal and bled off the bottom corner.
   *
   * The most recognisable mark in the game, and the right one for the screens
   * that are about a win - the table and the tally. Tinted red rather than
   * drawn in the ramp's green, because a red dragon that is not red is just a
   * box with a line through it.
   */
  | 'zhong'
  /**
   * The dots suit, as three overlapping rings.
   *
   * Quieter than the dragon and purely geometric, for the screens that are
   * lists rather than moments.
   */
  | 'rings'
  /**
   * A length of the wall, tiles stood on end.
   *
   * For the screens that are setup rather than play - rules, settings,
   * friends. A wall is what a table looks like before anybody has done
   * anything, which is what those screens are for.
   */
  | 'wall';

export interface BackdropProps {
  motif?: Motif;
}

/**
 * How strong the motif is.
 *
 * Two competing failures. Too strong and it is a watermark that fights the
 * scores, which are the only thing on these screens anybody came for. Too
 * weak - the first attempt, at 0.05 - and it is a smudge: you can tell
 * something is there and not what, which is worse than nothing because it
 * reads as a rendering fault.
 *
 * This sits where the shape is legible if you look at it and ignorable if you
 * do not. It is checked on the darkened lower half of the screen, which is
 * where both motifs sit and the hardest place for them to survive.
 */
const MOTIF_OPACITY = 0.09;

export function Backdrop({ motif = 'none' }: BackdropProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/*
        * Stretched rather than tiled - `preserveAspectRatio="none"` on a
        * gradient is free, and it means this costs one rect at any screen
        * size.
        */}
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 200">
        <Defs>
          <RadialGradient id="pool" cx="50%" cy="0%" r="90%">
            <Stop offset="0" stopColor={colors.surfaceHigh} stopOpacity={0.55} />
            <Stop offset="0.55" stopColor={colors.surface} stopOpacity={0.18} />
            <Stop offset="1" stopColor={colors.ground} stopOpacity={0} />
          </RadialGradient>
          {/*
            * The floor, deliberately shallower than it first was. At 0.22 the
            * bottom of a short list turned into a dead black band - it made
            * the emptiness look intentional rather than merely empty, and it
            * swallowed the motif that is supposed to be filling that space.
            */}
          <LinearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity={0} />
            <Stop offset="0.6" stopColor="#000000" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.14} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="200" fill={colors.ground} />
        <Rect x="0" y="0" width="100" height="200" fill="url(#pool)" />
        <Rect x="0" y="0" width="100" height="200" fill="url(#floor)" />
      </Svg>

      {motif === 'zhong' ? <Zhong /> : null}
      {motif === 'rings' ? <Rings /> : null}
      {motif === 'wall' ? <Wall /> : null}
    </View>
  );
}

/**
 * 中, drawn rather than typed.
 *
 * As paths and not as text: a CJK glyph in an SVG depends on whichever font
 * the platform decides to substitute, and the two platforms do not agree on
 * weight or on how much side bearing to leave. Drawn, it is the same mark on
 * both, and it is only a box with a stroke through it.
 */
function Zhong() {
  return (
    <View style={styles.zhong} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        {/*
          * Rotated a little off square and hung past the corner, so it reads
          * as a tile lying on the table rather than as a watermark somebody
          * placed. A mark that is fully visible and centred asks to be looked
          * at; this one is meant to be noticed second.
          */}
        <G rotation={-18} origin="50, 50" opacity={MOTIF_OPACITY}>
          <Rect
            x={22}
            y={26}
            width={56}
            height={48}
            rx={3}
            fill="none"
            stroke={colors.danger}
            strokeWidth={9}
          />
          <Rect x={45} y={2} width={10} height={96} rx={3} fill={colors.danger} />
        </G>
      </Svg>
    </View>
  );
}

/** The dots suit: three rings, overlapping, off the top corner. */
function Rings() {
  return (
    <View style={styles.rings} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <G opacity={MOTIF_OPACITY} fill="none" stroke={colors.lineStrong} strokeWidth={5}>
          <Circle cx={34} cy={34} r={26} />
          <Circle cx={68} cy={52} r={26} />
          <Circle cx={40} cy={74} r={26} />
        </G>
      </Svg>
    </View>
  );
}

/** A run of tiles stood on end, seen at a slight angle. */
function Wall() {
  return (
    <View style={styles.wall} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <G rotation={-12} origin="50, 50" opacity={MOTIF_OPACITY}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Rect
              key={i}
              x={6 + i * 18}
              y={22}
              width={13}
              height={56}
              rx={2.5}
              fill="none"
              stroke={colors.lineStrong}
              strokeWidth={3.5}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * Sized in points rather than as a fraction of the screen, and allowed to
   * overflow the edges. A motif that scales with the viewport is a different
   * size on every phone; one that bleeds is the same mark everywhere and the
   * screen edge does the cropping.
   */
  /*
   * Both hang past the bottom edge, which is where a list runs out and where
   * an app with nothing behind it looks unfinished. The dragon takes the right
   * corner and the rings the left, so the two screens do not read as the same
   * screen with different words on it.
   */
  zhong: { position: 'absolute', right: -96, bottom: -92, width: 460, height: 460 },
  rings: { position: 'absolute', left: -104, bottom: -104, width: 400, height: 400 },
  wall: { position: 'absolute', right: -70, bottom: -60, width: 380, height: 380 },
});
