import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Caption,
  Divider,
  EmptyState,
  Panel,
  PageHeader,
  Screen,
  Section,
  Title,
} from '@/design/components';
import { AwayIcon, HistoryIcon, PlayersIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { HandSummary } from '@/components/HandSummary';
import { MahjongTable } from '@/components/MahjongTable';
import { findRuleSet, sessionTotals, useAppState } from '@/store/store';
import { useFriends } from '@/store/friends';
import { plural } from '@/lib/format';

/**
 * A game somebody else scored.
 *
 * Laid out as your own session screen is - the table with everybody's
 * running total, then the hands in the same rows - because from where you sit
 * it is the same thing: a night you were at, and how it went. It used to be
 * its own layout with a "Your seat" panel and plainer hand rows, which made a
 * night scored on a friend's phone look like a lesser record of it.
 *
 * What it keeps from being different is that nothing on it responds. There is
 * no winner to tap, no seat to rename, no hand to open and no bin, and none of
 * those are drawn and then disabled: each would be a control that silently
 * fails, because the server only accepts writes from the phone that owns the
 * game. The header says whose game it is, and the foot says why it is fixed.
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

        <Section
          title="Hands"
          icon={<HistoryIcon size={15} color={colors.inkFaint} />}
          note={session.hands.length > 0 ? plural(session.hands.length, 'hand') : undefined}
        >
          {session.hands.length === 0 ? (
            <Panel style={styles.empty}>
              <PlayersIcon size={26} color={colors.inkFaint} />
              <Caption tone="faint" center style={styles.emptyNote}>
                Nothing scored yet
              </Caption>
            </Panel>
          ) : (
            <Panel flush>
              {session.hands.map((hand, index) => (
                <View key={hand.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.hand}>
                    <HandSummary hand={hand} session={session} />
                  </View>
                </View>
              ))}
            </Panel>
          )}
        </Section>

        <Caption tone="faint" style={styles.note}>
          Only {scorer} can change this game. Your copy updates when you are both online.
        </Caption>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl },
  byline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  empty: { alignItems: 'center', paddingVertical: space.xxl },
  emptyNote: { marginTop: space.xs },
  // The session screen's row, less the room its bin takes on the right.
  hand: { gap: 2, paddingHorizontal: space.lg, paddingVertical: space.md },
  note: { marginTop: space.lg, paddingHorizontal: space.xs },
});
