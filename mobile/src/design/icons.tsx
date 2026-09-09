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
 *
 * The situation icons at the end carry more weight than an icon usually does.
 * Every name this app has for what happened - kong, meld, self-draw, robbing
 * a kong - is a translation somebody invented, and none of them is what a
 * player calls it at their own table. Four identical tiles with one being
 * pulled out of them needs no translation. So on those screens the picture
 * does the explaining and the words underneath are only labels.
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

/**
 * Two seats and the tile between them.
 *
 * Deliberately half of `PlayersIcon`: friends are the people at the table who
 * also have the app, which is nearly always some of the four rather than all
 * of them. Drawing it as a table with two of its seats filled says that
 * without a word, and the two are drawn opposite each other because that is
 * where the pairs sit.
 */
export const FriendsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={4.6} cy={12} r={2} />
    <Circle cx={19.4} cy={12} r={2} />
    <Rect x={8.8} y={7.4} width={6.4} height={9.2} rx={1.6} />
  </Icon>
);

/**
 * A game somebody else scored.
 *
 * A tile arriving rather than a tile held: the hand came from another table
 * and this device only ever reads it.
 */
export const AwayIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={12.6} y={5.4} width={7.4} height={13.2} rx={1.8} />
    <Path d="M3.4 12h6.2" />
    <Path d="M7.2 9.4 9.8 12l-2.6 2.6" />
  </Icon>
);

/**
 * Google's mark, in Google's colours.
 *
 * The one icon in this file not drawn to the 24-unit grid and not tinted by
 * its `color` prop, because it is not ours. Google's identity guidelines
 * require the four-colour G unmodified, and a monochrome version tinted brass
 * would be both against the terms and the reason the button looked like an
 * advert for us rather than a way to sign in.
 */
export const GoogleMark = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path
      fill="#4285F4"
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <Path
      fill="#34A853"
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
    />
    <Path
      fill="#FBBC05"
      d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <Path
      fill="#EA4335"
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </Svg>
);

/**
 * Apple's mark, for the button beside Google's.
 *
 * Solid black rather than tinted, and drawn at Apple's proportions, because
 * the same reasoning applies as to the four-colour G: it is not our mark to
 * restyle. It only ever appears on the white `apple` button, which is one of
 * the two appearances Apple's guidelines allow.
 *
 * The button had no mark at all - Google's was there and Apple's was not,
 * which read as a rendering fault rather than as a design. Guideline 4.8 asks
 * for Sign in with Apple to be presented no less prominently than the
 * alternatives, and a button missing its logo next to one that has its logo is
 * exactly that.
 */
export const AppleMark = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      fill="#000000"
      d="M17.05 12.53c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.72-1.35-.14-2.64.79-3.33.79-.69 0-1.75-.77-2.87-.75-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.83-1.22 1.18-2.41 1.2-2.47-.03-.01-2.29-.88-2.31-3.49z"
    />
    <Path
      fill="#000000"
      d="M14.94 5.93c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.05 1.69-.92 2.69.98.08 1.98-.5 2.58-1.23z"
    />
  </Svg>
);

/**
 * A person, for the tab that is about you.
 *
 * The four-seat table mark that used to label it says "players", which is what
 * a session has; this tab is one person's own record. A silhouette is the one
 * place a generic glyph beats a game-drawn one, because every app on the phone
 * has taught the same thing with it.
 */
export const PersonIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={8} r={3.6} />
    <Path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </Icon>
);

/** A gear, which is what everybody's settings look like. */
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={12} r={3.1} />
    <Path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8M18.6 18.6l-1.8-1.8M7.2 7.2 5.4 5.4" />
  </Icon>
);

// ---------------------------------------------------------------------------
// Situations
//
// These are the ones carrying an idea rather than naming a screen, so they are
// drawn as small diagrams: a thing, and what happened to it.
// ---------------------------------------------------------------------------

/** The wall, two tiles high, with the last one gone. */
export const WallIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.6} y={5.4} width={5.4} height={5.6} rx={1.2} />
    <Rect x={9.3} y={5.4} width={5.4} height={5.6} rx={1.2} />
    <Rect x={16} y={5.4} width={5.4} height={5.6} rx={1.2} />
    <Rect x={2.6} y={13} width={5.4} height={5.6} rx={1.2} />
    <Rect x={9.3} y={13} width={5.4} height={5.6} rx={1.2} />
    <Path d="M16 13h5.4v5.6H16" strokeDasharray="2 2" />
  </Icon>
);

/**
 * A tile pushed out of the hand.
 *
 * One tile and one arrow. The first version was two small tiles joined by a
 * hairline arc, which at the eighteen pixels it is actually drawn at was a
 * smudge.
 */
export const DiscardIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={3.4} y={6.6} width={7.4} height={10.8} rx={1.8} />
    <Path d="M13.8 12h6.8M20.6 12l-2.6-2.6M20.6 12l-2.6 2.6" />
  </Icon>
);

/**
 * A tile lifted straight up out of the wall.
 *
 * The arrow points away from the row, because the tile came to the player
 * rather than being put down - drawn the other way up, this was an inbox.
 */
export const SelfDrawIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.2} y={14.4} width={5} height={7} rx={1.2} />
    <Rect x={9.5} y={14.4} width={5} height={7} rx={1.2} />
    <Rect x={16.8} y={14.4} width={5} height={7} rx={1.2} />
    <Rect x={9.5} y={2.6} width={5} height={8.4} rx={1.2} />
  </Icon>
);

/** Four identical tiles doing the work of three. */
export const KongIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={1.6} y={7} width={4.4} height={10} rx={1.1} />
    <Rect x={7.1} y={7} width={4.4} height={10} rx={1.1} />
    <Rect x={12.6} y={7} width={4.4} height={10} rx={1.1} />
    <Rect x={18.1} y={7} width={4.4} height={10} rx={1.1} />
  </Icon>
);

/** The tile somebody was adding to a triplet, claimed on its way down. */
export const RobKongIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.4} y={10.4} width={4.6} height={9.2} rx={1.2} />
    <Rect x={8.1} y={10.4} width={4.6} height={9.2} rx={1.2} />
    <Rect x={13.8} y={10.4} width={4.6} height={9.2} rx={1.2} />
    <Rect x={16.6} y={2} width={4.6} height={6.2} rx={1.2} />
    <Path d="M14.2 7.4 18.9 8.2" />
  </Icon>
);

/** The last of its kind: three already gone, one left. */
export const LastOfKindIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M2.4 8.2h3.4v7.6H2.4Z" strokeDasharray="2 2" />
    <Path d="M7.6 8.2H11v7.6H7.6Z" strokeDasharray="2 2" />
    <Path d="M12.8 8.2h3.4v7.6h-3.4Z" strokeDasharray="2 2" />
    <Rect x={18} y={6.4} width={4.6} height={11.2} rx={1.2} />
  </Icon>
);

/** A hand one tile short, with the gap where it goes. */
export const ReadyIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={1.8} y={7.6} width={4.4} height={8.8} rx={1.1} />
    <Rect x={7.2} y={7.6} width={4.4} height={8.8} rx={1.1} />
    <Rect x={12.6} y={7.6} width={4.4} height={8.8} rx={1.1} />
    <Path d="M18 7.6h4.4v8.8H18Z" strokeDasharray="2 2" />
  </Icon>
);

/** The betting stick put down to declare. */
export const RiichiStickIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.2} y={9.4} width={19.6} height={5.2} rx={2.6} />
    <Circle cx={12} cy={12} r={1.5} />
  </Icon>
);

/** A tile marked as worth extra. */
export const DoraIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={5.4} y={2.8} width={13.2} height={18.4} rx={2.4} />
    <Path d="m12 7.4 1.5 3.5 3.6.3-2.7 2.4.8 3.6L12 15.3 8.8 17.2l.8-3.6-2.7-2.4 3.6-.3Z" />
  </Icon>
);

/** The dice that break the wall: the deal itself. */
export const DealIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={3.4} y={3.4} width={17.2} height={17.2} rx={3.6} />
    <Circle cx={8.4} cy={8.4} r={1.2} />
    <Circle cx={15.6} cy={8.4} r={1.2} />
    <Circle cx={12} cy={12} r={1.2} />
    <Circle cx={8.4} cy={15.6} r={1.2} />
    <Circle cx={15.6} cy={15.6} r={1.2} />
  </Icon>
);

/**
 * A hand laid inside the viewfinder.
 *
 * Corner brackets rather than a closed box: a rounded rectangle with bars
 * inside it and anything at all on one end reads as a battery, which is what
 * the first attempt at this turned out to be.
 */
export const FramingIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M2.4 8.4V4.9a2.5 2.5 0 0 1 2.5-2.5h3.5" />
    <Path d="M15.6 2.4h3.5a2.5 2.5 0 0 1 2.5 2.5v3.5" />
    <Path d="M21.6 15.6v3.5a2.5 2.5 0 0 1-2.5 2.5h-3.5" />
    <Path d="M8.4 21.6H4.9a2.5 2.5 0 0 1-2.5-2.5v-3.5" />
    <Rect x={6.6} y={9} width={3.2} height={6} rx={0.9} />
    <Rect x={11} y={9} width={3.2} height={6} rx={0.9} />
    <Rect x={15.4} y={9} width={2} height={6} rx={0.7} strokeDasharray="1.6 1.6" />
  </Icon>
);

/** Tiles resting flat on the table, in one level row. */
export const FlatRowIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x={2.6} y={6.4} width={5} height={9} rx={1.2} />
    <Rect x={9.5} y={6.4} width={5} height={9} rx={1.2} />
    <Rect x={16.4} y={6.4} width={5} height={9} rx={1.2} />
    <Path d="M1.6 18.6h20.8" />
  </Icon>
);
