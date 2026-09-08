import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Body,
  BodyStrong,
  Caption,
  CaptionStrong,
  Divider,
  EmptyState,
  Panel,
  PageHeader,
  Screen,
  Section,
  Title,
  TileFace,
} from '@/design/components';
import { AwayIcon, HistoryIcon, PlayersIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { MahjongTable } from '@/components/MahjongTable';
import { findRuleSet, sessionTotals, useAppState } from '@/store/store';
import { useFriends } from '@/store/friends';
import { plural, relativeDate, signed } from '@/lib/format';
import type { HandRecord, Session } from '@/store/types';

/**
 * A game somebody else scored.
 *
 * Deliberately not the session screen with the buttons hidden. This is a
 * different thing: a record of a night, arrived from another phone, that
 * cannot be changed here and should not look as though it could. Nothing on it
 * is tappable, there is no way to add a hand, and the seats do not rename -
 * every one of those would be a control that silently fails, because the
 * server will only accept writes from the device that owns the game.
 *
 * What it is for is the same thing the session screen is for: seeing what
 * happened and what it cost. The one addition is saying whose game it is, and
 * that it updates on its own.
 */
export default function AwayGameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const game = useAppState(
    useCallback((state) => state.awayGames.find((g) => g.session.id === id), [id]),
  );
  const friends = useFriends(useCallback((state) => state.friends, []));

  if (!game) {
    return (
      <Screen>
        <EmptyState
          icon={<AwayIcon size={28} color={colors.inkFaint} />}
          title="Not here any more"
          body="Whoever scored this game has taken you out of it, or deleted it."
        />
      </Screen>
    );
  }

  const { session } = game;
  const owner = friends.find((friend) => friend.id === game.ownerId);
  const scorer = owner?.displayName || owner?.handle || 'A friend';
  const mine = session.players.find((player) => player.id === game.playerId);
  const rules = findRuleSet(session.ruleSetId);
  const totals = sessionTotals(session);

  return (
    <Screen scroll motif="zhong" padded={false}>
      {/* Same reason as the session screen: an empty navigation bar was
          spending a row to show one chevron. */}
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader>
        <Title>{session.name}</Title>
        <View style={styles.byline}>
          <AwayIcon size={14} color={colors.inkFaint} />
          <Caption tone="faint">
            Scored by {scorer} · {rules?.name ?? 'Unknown rules'}
          </Caption>
        </View>
      </PageHeader>
      <View style={styles.body}>

      <MahjongTable
        players={session.players}
        totals={totals}
        dealerId={session.dealerId}
        dealerStreak={session.dealerStreak ?? 0}
        roundWind={session.roundWind}
        handCount={session.hands.length}
        // Read-only: there is nothing here to select or rename, and a control
        // that appears to work and does not is worse than no control.
        onSelect={() => {}}
        onRename={() => {}}
      />

      {mine ? (
        <Section title="Your seat" icon={<PlayersIcon size={15} color={colors.inkFaint} />}>
          <Panel style={styles.seat}>
            <TileFace code={mine.seat} width={30} />
            <View style={styles.seatBody}>
              <BodyStrong>{mine.name}</BodyStrong>
              <Caption tone="muted">
                {signed(totals[mine.id] ?? 0)} across {plural(session.hands.length, 'hand')}
              </Caption>
            </View>
          </Panel>
        </Section>
      ) : null}

      <Section title="Hands" icon={<HistoryIcon size={15} color={colors.inkFaint} />}>
        {session.hands.length === 0 ? (
          <Panel style={styles.empty}>
            <Caption tone="faint">Nothing scored yet.</Caption>
          </Panel>
        ) : (
          <Panel flush>
            {session.hands.map((hand, index) => (
              <View key={hand.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <AwayHand hand={hand} session={session} />
              </View>
            ))}
          </Panel>
        )}
      </Section>

        <Caption tone="faint" style={styles.note}>
          This is {scorer}&apos;s copy. It updates when you are both online, and disappears if they
          take you out of the game.
        </Caption>
      </View>
    </Screen>
  );
}

function AwayHand({ hand, session }: { hand: HandRecord; session: Session }) {
  const winner = session.players.find((p) => p.id === hand.winnerId);
  const discarder = session.players.find((p) => p.id === hand.discarderId);
  const how =
    hand.discarderId === null ? 'Self-drawn' : `Discarded by ${discarder?.name ?? 'someone'}`;

  return (
    <View style={styles.hand}>
      <View style={styles.handBody}>
        <Body>{winner?.name ?? 'Someone'}</Body>
        <Caption tone="faint">
          {how} · {relativeDate(hand.createdAt)}
        </Caption>
        {hand.summary.topPatterns.length > 0 ? (
          <Caption tone="muted">{hand.summary.topPatterns.join(' · ')}</Caption>
        ) : null}
      </View>
      <CaptionStrong tone="accent" numeric>
        {hand.summary.total} {hand.summary.unit}
      </CaptionStrong>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl },
  byline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  seat: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  seatBody: { flex: 1, gap: 2 },
  empty: { alignItems: 'center', paddingVertical: space.lg },
  hand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  handBody: { flex: 1, gap: 2 },
  note: { marginTop: space.lg, paddingHorizontal: space.xs },
});
