import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BodyStrong, Caption, CaptionStrong, CountUp, TileFace } from '@/design/components';
import { colors, radius, shadow, space } from '@/design/tokens';
import type { SessionPlayer } from '@/store/types';
import type { Wind } from '@/tiles/tileset';
import { WIND_LABEL } from '@/lib/format';

/**
 * The session as a table you sit at.
 *
 * A list of four names sorted by score is the wrong shape for this. Players
 * think in seats - the dealer is to my left, east is across from me - and the
 * seat is what the scoring depends on. Laying them out where they actually sit
 * makes "who won this hand" a tap on the person rather than a lookup in a list,
 * and makes the dealer's position something you can see instead of read.
 *
 * This is the one screen allowed to look like its subject. The seat winds are
 * the real tile faces rather than characters set in the UI font, and the centre
 * is baize inside a wooden rim, because a screen standing in for a table reads
 * as a panel until it stops pretending otherwise. That palette lives here and
 * does not leak into the rest of the app.
 *
 * Names start as Player 1 through 4 and are set from the Who's here list
 * under the table, not here. Holding a seat to rename it was a gesture nobody
 * found, on a card whose tap already means "this person won"; the list is
 * where the seats are about who is sitting in them.
 */

interface Props {
  players: readonly SessionPlayer[];
  totals: Record<string, number>;
  dealerId: string;
  /** Consecutive deals the dealer has held - 連莊. */
  dealerStreak?: number;
  roundWind: Wind;
  handCount: number;
  /** Highlighted while choosing who a hand was won by. */
  selectedId?: string | null;
  onSelect: (playerId: string) => void;
}

/** Seat positions, clockwise from the near side. */
const SLOTS = ['bottom', 'right', 'top', 'left'] as const;
type Slot = (typeof SLOTS)[number];

const SEAT_WIDTH = 92;
const SEAT_HEIGHT = 76;
const WIND_TILE = 20;
/** The baize is square, because a mahjong table is. */
const FELT_SIZE = 164;
/**
 * The wooden edge, and the radius the baize needs so that edge stays even.
 *
 * Two concentric rounded rectangles only produce a band of constant width when
 * the inner radius is the outer one minus the inset - that is what puts both
 * corner arcs on the same centre. With the inner radius set independently the
 * arcs drift apart and the band pinches: at 20 outside, 14 inside and a 3pt
 * inset the gold narrowed to about 1.7pt on the diagonal while staying 3pt
 * along the flats, which is exactly the thin corner it looked like.
 */
const RIM_WIDTH = 3;
const FELT_RADIUS = radius.xl - RIM_WIDTH;

function Seat({
  player,
  total,
  isDealer,
  streak,
  selected,
  slot,
  onSelect,
}: {
  player: SessionPlayer;
  total: number;
  isDealer: boolean;
  streak: number;
  selected: boolean;
  slot: Slot;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        `${player.name}, seated ${WIND_LABEL[player.seat]}, ${total} points` +
        (isDealer ? `, dealing${streak > 0 ? ` for ${streak + 1} hands` : ''}` : '')
      }
      onPress={onSelect}
      style={({ pressed }) => [
        styles.seat,
        styles[slot],
        isDealer && styles.seatDealer,
        selected && styles.seatSelected,
        pressed && styles.seatPressed,
      ]}
    >
      <View style={styles.seatHead}>
        {/* The wind as the tile it is, not as a character in the UI font. */}
        <TileFace code={player.seat} width={WIND_TILE} />
        {/*
          * A streak replaces the word rather than crowding in beside it.
          *
          * The brass border and the warmer surface already say "dealer" on
          * their own, so once there is a number to show, the number is the
          * more useful thing to spend ninety pixels on: it is what the table
          * is watching, and under Taiwanese scoring it is what the dealer is
          * about to win or lose by.
          */}
        {isDealer && streak > 0 ? (
          <View style={styles.streak}>
            <CaptionStrong tone="onAccent" numeric>
              {streak}
            </CaptionStrong>
          </View>
        ) : isDealer ? (
          <Caption tone="accent">Dealer</Caption>
        ) : null}
      </View>

      {/*
        * Plain text, not a pressable. The whole seat is the button - a name
        * that handled its own presses left the middle of the card dead to the
        * tap that selects the player, which is the thing you do every hand.
        */}
      <BodyStrong numberOfLines={2}>{player.name}</BodyStrong>

      {/* Ticks from its old value when a hand lands, so you see who moved. */}
      <CountUp
        value={total}
        signed
        variant="caption"
        tone={total > 0 ? 'gain' : total < 0 ? 'loss' : 'muted'}
      />
    </Pressable>
  );
}

export function MahjongTable({
  players,
  totals,
  dealerId,
  dealerStreak = 0,
  roundWind,
  handCount,
  selectedId,
  onSelect,
}: Props) {
  return (
    <View style={styles.table}>
      <View style={styles.rim}>
        <View style={styles.felt}>
          {/*
            * The round wind belongs here rather than in a subtitle: it is table
            * state, it changes during play, and it is the thing people forget.
            * Putting it where the wall would sit makes the middle of the table
            * say something instead of holding a hint.
            */}
          <TileFace code={roundWind} width={34} />
          <Caption tone="muted">{WIND_LABEL[roundWind]} round</Caption>
          <Caption tone="faint">
            {handCount === 0 ? 'No hands yet' : `${handCount} ${handCount === 1 ? 'hand' : 'hands'}`}
          </Caption>
        </View>
      </View>

      {players.slice(0, 4).map((player, index) => (
        <Seat
          key={player.id}
          player={player}
          total={totals[player.id] ?? 0}
          isDealer={player.id === dealerId}
          streak={player.id === dealerId ? dealerStreak : 0}
          selected={selectedId === player.id}
          slot={SLOTS[index]}
          onSelect={() => onSelect(player.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    height: FELT_SIZE + 2 * (SEAT_HEIGHT + space.sm),
    marginTop: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The wooden edge. Thin, warm, and the only wood in the app.
   *
   * Sized rather than stretched between the seats: a table is square, and
   * letting it take whatever space the seats left over made it a tall slot on a
   * narrow phone and a wide one on a large screen.
   */
  rim: {
    position: 'absolute',
    ...shadow.raised,
    width: FELT_SIZE,
    height: FELT_SIZE,
    top: SEAT_HEIGHT + space.sm,
    alignSelf: 'center',
    borderRadius: radius.xl,
    padding: RIM_WIDTH,
    backgroundColor: colors.rim,
  },
  felt: {
    flex: 1,
    borderRadius: FELT_RADIUS,
    backgroundColor: colors.felt,
    borderWidth: 1,
    borderColor: colors.feltLine,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  seat: {
    position: 'absolute',
    width: SEAT_WIDTH,
    minHeight: SEAT_HEIGHT,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: space.xxs,
    ...shadow.sunken,
  },
  /** The dealer's place is warmer, the way a dealer's seat is marked. */
  seatDealer: { borderColor: colors.brassDim, backgroundColor: colors.surfaceHigh },
  /*
   * Green fill, not a gold outline. The dealer's seat is already outlined in
   * brass, and a second brass outline for "selected" made the two states
   * indistinguishable at a glance - which is the one thing this screen has to
   * get right, since you tap a seat every hand and the dealer never moves.
   */
  seatSelected: { borderColor: colors.feltLine, backgroundColor: colors.feltHigh },
  seatPressed: { backgroundColor: colors.surfaceHigh },
  seatHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /** The one brass fill on this screen, because it is the one live number. */
  streak: {
    minWidth: 22,
    paddingHorizontal: space.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.brass,
    alignItems: 'center',
  },

  bottom: { bottom: 0, alignSelf: 'center' },
  top: { top: 0, alignSelf: 'center' },
  left: { left: 0 },
  right: { right: 0 },
});
