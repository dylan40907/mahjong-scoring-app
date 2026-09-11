import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BodyStrong, Caption, CaptionStrong } from '@/design/components';
import { space } from '@/design/tokens';
import { relativeDate, scoreLabel } from '@/lib/format';
import type { HandRecord, Session } from '@/store/types';

/**
 * One scored hand as a line in a list: who won, what it paid, how it was won,
 * and why it was worth that.
 *
 * Shared by your own sessions and by games a friend scored, so the two read
 * the same. They used to be drawn separately and had drifted - a friend's game
 * printed "1 faan" where yours said "Limit hand", and set the winner in a
 * lighter weight - which made the same night look different depending on
 * whose phone had kept score. The session screen wraps this in a tap to edit
 * and a bin; a friend's game shows it as it is, because it cannot be changed
 * from here.
 */
export function HandSummary({ hand, session }: { hand: HandRecord; session: Session }) {
  const winner = session.players.find((p) => p.id === hand.winnerId);
  const discarder = session.players.find((p) => p.id === hand.discarderId);
  const how =
    hand.discarderId === null ? 'Self-drawn' : `Discarded by ${discarder?.name ?? 'someone'}`;

  return (
    <>
      <View style={styles.header}>
        <BodyStrong numberOfLines={1} style={styles.winner}>
          {winner?.name ?? 'Unknown'}
        </BodyStrong>
        <CaptionStrong tone="accent" numeric>
          {hand.summary.limitName ?? scoreLabel(hand.summary.total, hand.summary.unit)}
        </CaptionStrong>
      </View>
      <Caption tone="faint" numberOfLines={1}>
        {how} · {relativeDate(hand.createdAt)}
      </Caption>
      {hand.summary.topPatterns.length > 0 ? (
        /* Wraps. This is the one line that says *why* the hand was worth
           what it was worth, and it was reliably the line that got cut. */
        <Caption tone="muted" style={styles.patterns}>
          {hand.summary.topPatterns.join(' · ')}
        </Caption>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  winner: { flex: 1 },
  patterns: { marginTop: 1 },
});
