import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BodyStrong, Caption, CaptionStrong } from '@/design/components';
import { space } from '@/design/tokens';
import { relativeDate } from '@/lib/format';
import { breakdownOf, scoreText, type RuleSet } from '@/scoring';
import { asHandInput, groupsFrom, scoreStored } from '@/store/stats';
import type { HandRecord, Session } from '@/store/types';
import type { HandSheet } from './HandBreakdown';
import { HandTiles } from './HandTiles';

/**
 * One scored hand as a line in a list: who won, what it was worth, how it was
 * won, and the tiles.
 *
 * The tiles replaced the list of pattern names that used to sit here. The
 * names said what scored and not how much, and a hand is recognised at a
 * glance by its tiles far sooner than by "Half Flush · No Flowers or
 * Seasons". What each pattern was worth is one tap away, in the breakdown.
 *
 * Shared by your own sessions and by games a friend scored, so the two read
 * the same. The worth is read by scoring the hand again under the session's
 * rules rather than from what was saved with it: a limit hand saved by an
 * older scorer carried the four faan its other patterns summed to, and read
 * as a modest hand beside the ten it was paid as.
 */
export function HandSummary({
  hand,
  session,
  rules,
}: {
  hand: HandRecord;
  session: Session;
  rules: RuleSet | undefined;
}) {
  const winner = session.players.find((p) => p.id === hand.winnerId);
  const result = useMemo(() => scoreStored(hand.hand, rules), [hand.hand, rules]);
  const worth = result
    ? scoreText(result.total, result.unit, result.limitName)
    : scoreText(hand.summary.total, hand.summary.unit, hand.summary.limitName);

  return (
    <>
      <View style={styles.header}>
        <BodyStrong numberOfLines={1} style={styles.winner}>
          {winner?.name ?? 'Unknown'}
        </BodyStrong>
        <CaptionStrong tone="accent" numeric>
          {worth}
        </CaptionStrong>
      </View>
      <Caption tone="faint" numberOfLines={1}>
        {howItWasWon(hand, session)} · {relativeDate(hand.createdAt)}
      </Caption>
      <View style={styles.tiles}>
        <HandTiles groups={result ? groupsFrom(result, hand.hand) : null} tiles={allTiles(hand)} />
      </View>
    </>
  );
}

function howItWasWon(hand: HandRecord, session: Session): string {
  if (hand.discarderId === null) return 'Self-drawn';
  const discarder = session.players.find((p) => p.id === hand.discarderId);
  return `Discarded by ${discarder?.name ?? 'someone'}`;
}

function allTiles(hand: HandRecord) {
  return [...(hand.hand.exposed ?? []), ...hand.hand.concealed, ...(hand.hand.bonus ?? [])];
}

/**
 * The breakdown sheet for a hand in a session.
 *
 * Payments come from what was stored when the hand was scored - they are what
 * actually changed hands - and run winner first, then the rest by what they
 * paid.
 */
export function sheetForHand(
  hand: HandRecord,
  session: Session,
  rules: RuleSet | undefined,
): HandSheet {
  const winner = session.players.find((p) => p.id === hand.winnerId);
  const result = scoreStored(hand.hand, rules);
  const payments = session.players
    .map((player) => ({ name: player.name, amount: hand.deltas[player.id] ?? 0 }))
    .sort((a, b) => b.amount - a.amount);

  return {
    title: `${winner?.name ?? 'Someone'}’s hand`,
    subtitle: `${howItWasWon(hand, session)} · ${relativeDate(hand.createdAt)}`,
    groups: result ? groupsFrom(result, hand.hand) : null,
    tiles: allTiles(hand),
    breakdown: result && rules ? breakdownOf(result, asHandInput(hand.hand), rules) : null,
    fallback: {
      total: scoreText(hand.summary.total, hand.summary.unit, hand.summary.limitName),
      patterns: hand.summary.topPatterns,
    },
    payments,
  };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  winner: { flex: 1 },
  tiles: { marginTop: space.sm },
});
