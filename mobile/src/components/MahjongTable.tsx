import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Body, BodyStrong, Caption, CaptionStrong } from '@/design/components';
import { colors, radius, space } from '@/design/tokens';
import type { SessionPlayer } from '@/store/types';
import { WIND_GLYPH } from '@/lib/format';

/**
 * The session as a table you sit at.
 *
 * A list of four names sorted by score is the wrong shape for this. Players
 * think in seats - the dealer is to my left, east is across from me - and the
 * seat is what the scoring depends on. Laying them out where they actually sit
 * makes "who won this hand" a tap on the person rather than a lookup in a list,
 * and makes the dealer's position something you can see instead of read.
 *
 * Names start as Player 1 through 4 and are edited in place, because naming
 * four people is a thing you do once somebody wins, not before the game starts.
 */

interface Props {
  players: readonly SessionPlayer[];
  totals: Record<string, number>;
  dealerId: string;
  /** Highlighted while choosing who a hand was won by. */
  selectedId?: string | null;
  onSelect: (playerId: string) => void;
  onRename: (playerId: string, name: string) => void;
}

/** Seat positions, clockwise from the near side. */
const SLOTS = ['bottom', 'right', 'top', 'left'] as const;
type Slot = (typeof SLOTS)[number];

function Seat({
  player,
  total,
  isDealer,
  selected,
  slot,
  onSelect,
  onRename,
}: {
  player: SessionPlayer;
  total: number;
  isDealer: boolean;
  selected: boolean;
  slot: Slot;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(player.name);

  const commit = () => {
    const trimmed = text.trim();
    onRename(trimmed.length > 0 ? trimmed : player.name);
    setEditing(false);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player.name}, ${WIND_GLYPH[player.seat]}, ${total} points`}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.seat,
        styles[slot],
        selected && styles.seatSelected,
        pressed && styles.seatPressed,
      ]}
    >
      <View style={styles.seatHead}>
        <Caption tone={isDealer ? 'accent' : 'faint'}>{WIND_GLYPH[player.seat]}</Caption>
        {isDealer ? <Caption tone="accent">Dealer</Caption> : null}
      </View>

      {editing ? (
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          selectTextOnFocus
          style={styles.nameInput}
          maxLength={18}
          accessibilityLabel="Player name"
        />
      ) : (
        /*
         * Long press, not tap. Choosing who won happens every hand and renaming
         * happens once, so the name must not swallow the tap that selects the
         * seat underneath it.
         */
        <BodyStrong
          numberOfLines={1}
          onLongPress={() => {
            setText(player.name);
            setEditing(true);
          }}
          accessibilityHint="Long press to rename"
        >
          {player.name}
        </BodyStrong>
      )}

      <CaptionStrong numeric tone={total > 0 ? 'gain' : total < 0 ? 'loss' : 'muted'}>
        {total > 0 ? `+${total}` : `${total}`}
      </CaptionStrong>
    </Pressable>
  );
}

export function MahjongTable({
  players,
  totals,
  dealerId,
  selectedId,
  onSelect,
  onRename,
}: Props) {
  return (
    <View style={styles.table}>
      <View style={styles.felt}>
        <Body tone="faint" style={styles.feltHint}>
          Tap whoever won
        </Body>
      </View>

      {players.slice(0, 4).map((player, index) => (
        <Seat
          key={player.id}
          player={player}
          total={totals[player.id] ?? 0}
          isDealer={player.id === dealerId}
          selected={selectedId === player.id}
          slot={SLOTS[index]}
          onSelect={() => onSelect(player.id)}
          onRename={(name) => onRename(player.id, name)}
        />
      ))}
    </View>
  );
}

const SEAT_WIDTH = 104;
const SEAT_HEIGHT = 74;

const styles = StyleSheet.create({
  table: {
    height: 300,
    marginTop: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The centre, kept quiet: it is a backdrop, not a feature.
   *
   * Inset by a whole seat rather than half of one, so the side seats sit beside
   * it rather than on top of it.
   */
  felt: {
    position: 'absolute',
    left: SEAT_WIDTH + space.xs,
    right: SEAT_WIDTH + space.xs,
    top: SEAT_HEIGHT + space.xs,
    bottom: SEAT_HEIGHT + space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feltHint: { textAlign: 'center' },
  seat: {
    position: 'absolute',
    width: SEAT_WIDTH,
    minHeight: SEAT_HEIGHT,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 2,
  },
  seatSelected: { borderColor: colors.brass, backgroundColor: colors.brassWash },
  seatPressed: { backgroundColor: colors.surfaceHigh },
  seatHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameInput: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.brass,
  },

  bottom: { bottom: 0, alignSelf: 'center' },
  top: { top: 0, alignSelf: 'center' },
  left: { left: 0 },
  right: { right: 0 },
});
