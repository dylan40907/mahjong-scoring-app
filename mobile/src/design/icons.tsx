import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './tokens';

/**
 * A hand-drawn icon set, deliberately small.
 *
 * Emoji standing in for icons is the single most recognisable tell of a
 * machine-assembled interface, and icon libraries drag in hundreds of glyphs
 * drawn to somebody else's grid. One 24-unit grid, one stroke weight, round
 * joins throughout: enough for this app, and consistent because there is
 * nothing to be inconsistent with.
 *
 * The second half of this file is drawn from the game rather than from the
 * usual interface vocabulary - a wind rose, a flower, three tiles set down,
 * a tile turned face down. Those exist because the screens they label are
 * about mahjong and were reading as a form, and a generic glyph on a section
 * heading is worse than no glyph: it says "this is a section" twice.
 */

export interface IconProps {
  size?: number;
  /** ColorValue rather than string: navigator tint props hand over opaque
   *  platform colours, not hex strings. */
  color?: ColorValue;
  strokeWidth?: number;
}

function Icon({
  size = 22,
  color = colors.ink,
  strokeWidth = 1.7,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 8.5A2 2 0 0 1 5 6.5h2.2a1 1 0 0 0 .84-.46l.92-1.42a1 1 0 0 1 .84-.46h4.4a1 1 0 0 1 .84.46l.92 1.42a1 1 0 0 0 .84.46H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <Circle cx={12} cy={12.5} r={3.4} />
  </Icon>
);

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={3} y={4.5} width={18} height={15} rx={2.2} />
    <Circle cx={8.6} cy={10} r={1.5} />
    <Path d="m3.6 17 4.3-4.3a1.6 1.6 0 0 1 2.2 0l3 3M14 14.5l1.6-1.6a1.6 1.6 0 0 1 2.2 0l2.6 2.5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="m4.5 12.5 4.8 4.8L19.5 7" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="m9.5 5 7 7-7 7" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="m14.5 5-7 7 7 7" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="m5 9.5 7 7 7-7" />
  </Icon>
);

export const RulesIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 6.5h14M5 12h14M5 17.5h14" />
    <Circle cx={9} cy={6.5} r={2} fill={colors.ground} />
    <Circle cx={15.5} cy={12} r={2} fill={colors.ground} />
    <Circle cx={8} cy={17.5} r={2} fill={colors.ground} />
  </Icon>
);

export const SessionsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={3.2} y={4.5} width={7} height={15} rx={1.8} />
    <Rect x={13.8} y={4.5} width={7} height={15} rx={1.8} />
    <Path d="M6.7 9v6M17.3 9v6" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M7 4.5v6M7 14v5.5M17 4.5v5M17 12.5v7" />
    <Circle cx={7} cy={12.2} r={2} />
    <Circle cx={17} cy={10.8} r={2} />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4.5 6.5h15M9.5 6.5V5a1.2 1.2 0 0 1 1.2-1.2h2.6A1.2 1.2 0 0 1 14.5 5v1.5" />
    <Path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
    <Path d="M10.5 10v6.5M13.5 10v6.5" />
  </Icon>
);

export const EditIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 20h4.2l9.4-9.4a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8Z" />
    <Path d="m14.2 6.6 3.2 3.2" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <Path d="M20.4 4.5v4.2h-4.2" />
  </Icon>
);

export const TileIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={4.5} y={2.8} width={15} height={18.4} rx={2.6} />
    <Path d="M9 8.2h6M9 12h6M9 15.8h3.2" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={12} r={8.6} />
    <Path d="M12 11v5.2M12 7.9v.1" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 4.2 2.8 20h18.4Z" />
    <Path d="M12 10v4.4M12 17.3v.1" />
  </Icon>
);

// ---------------------------------------------------------------------------
// Drawn from the game
// ---------------------------------------------------------------------------

/** The four winds, as the rose in the middle of a table. */
export const WindIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 2.6 14.4 9.6 21.4 12 14.4 14.4 12 21.4 9.6 14.4 2.6 12 9.6 9.6Z" />
  </Icon>
);

/** A flower or season, set aside from the hand proper. */
export const FlowerIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={12} r={2.4} />
    <Path d="M12 9.6V4.4M12 14.4v5.2M9.6 12H4.4M14.4 12h5.2" />
    <Path d="m10.3 10.3-3-3M13.7 13.7l3 3M13.7 10.3l3-3M10.3 13.7l-3 3" />
  </Icon>
);

/** Three tiles set down together: a declared meld. */
export const MeldIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.4} y={6} width={5.6} height={12} rx={1.4} />
    <Rect x={9.2} y={6} width={5.6} height={12} rx={1.4} />
    <Rect x={16} y={6} width={5.6} height={12} rx={1.4} />
  </Icon>
);

/** A tile turned face down: a kong declared but never shown. */
export const ConcealedIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={4.5} y={2.8} width={15} height={18.4} rx={2.6} />
    <Path d="m8 8 8 8M16 8l-8 8" />
  </Icon>
);

/** The hand that won. */
export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M7 4h10v5.2a5 5 0 0 1-10 0Z" />
    <Path d="M7 5.6H4.6v1.6a3 3 0 0 0 3 3M17 5.6h2.4v1.6a3 3 0 0 1-3 3" />
    <Path d="M12 14.2v3.4M8.6 20.4h6.8" />
  </Icon>
);

/** What changes hands when a score is settled. */
export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={9} cy={9} r={5.4} />
    <Path d="M14.1 6.4a5.4 5.4 0 0 1 0 11.2M6.4 14.1a5.4 5.4 0 0 0 11.2 0" />
  </Icon>
);

/** The moment a hand scores. */
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3.2 13.9 9 19.8 10.9 13.9 12.8 12 18.6 10.1 12.8 4.2 10.9 10.1 9Z" />
    <Path d="M18.6 3.4v2.8M20 4.8h-2.8" />
  </Icon>
);

/** Past hands, in the order they were played. */
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
    <Path d="M3.4 3.6v4.2h4.2" />
    <Path d="M12 7.6V12l3 1.8" />
  </Icon>
);

/** The area of a photograph being kept. */
export const CropIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6.4 2.6v15h15M2.6 6.4h15v15" />
  </Icon>
);

/** The people at the table. */
export const PlayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={4.6} r={2} />
    <Circle cx={12} cy={19.4} r={2} />
    <Circle cx={4.6} cy={12} r={2} />
    <Circle cx={19.4} cy={12} r={2} />
    <Rect x={8.6} y={8.6} width={6.8} height={6.8} rx={1.6} />
  </Icon>
);
