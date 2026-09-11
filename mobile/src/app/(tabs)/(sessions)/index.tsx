import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  PageHeader,
  Body,
  Caption,
  CaptionStrong,
  Button,
  EmptyState,
  Heading,
  Screen,
} from '@/design/components';
import { AwayIcon, GearIcon, PlayersIcon, PlusIcon, SessionsIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import {
  createQuickSession,
  createSessionLike,
  findRuleSet,
  sessionTotals,
  useAppState,
} from '@/store/store';
import { useFriends, type Friend } from '@/store/friends';
import type { AwayGame, Session } from '@/store/types';
import { plural, relativeDate, signed } from '@/lib/format';

/**
 * The sessions list.
 *
 * Each row carries the standings, because that is the question someone opens
 * this app to answer between hands. The ruleset and hand count are secondary
 * and sit in a single muted line rather than in separate labelled fields.
 */
export default function SessionsScreen() {
  const router = useRouter();

  /**
   * Straight to the table, with nothing to fill in first.
   *
   * The old form asked for a session name, four player names and a ruleset
   * before a single tile had been thrown. All four are visible on the table
   * itself and each is one tap to change, so asking up front only delayed the
   * game. The name is the time you sat down and the rules are whatever you
   * played last.
   */
  const startSession = () => {
    const session = createQuickSession();
    router.push(`/session/${session.id}`);
  };
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const awayGames = useAppState(useCallback((state) => state.awayGames, []));
  const friends = useFriends(useCallback((state) => state.friends, []));
  const ready = useAppState(useCallback((state) => state.ready, []));

  /*
   * Every game you were at, as one list, most recently played first.
   *
   * Friends' games used to sit in their own section below yours, as a
   * quieter card showing only your own line - so a night somebody else scored
   * looked like a lesser kind of night, and the question the list exists to
   * answer, how everybody finished, needed a tap to find out. They are the same
   * thing from where you sit: a table you were at, and how it went. What is
   * different is who can change it, and that is what the byline says.
   *
   * Sorted by `updatedAt` because that is the date each card shows, so the
   * list reads in order down the page.
   */
  const entries = useMemo(
    () =>
      [
        ...sessions.map((session) => ({ session, away: null as AwayGame | null })),
        ...awayGames.map((game) => ({ session: game.session, away: game as AwayGame | null })),
      ].sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt)),
    [sessions, awayGames],
  );

  // Somebody whose friends do all the scoring still has a history, and it
  // would be an odd first screen that told them they had none.
  if (ready && sessions.length === 0 && awayGames.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={<SessionsIcon size={40} color={colors.inkFaint} />}
          title="No sessions yet"
          body="Keep score across a run of hands. The deal and the standings follow along."
          action={
            <Button
              label="New Session"
              variant="primary"
              icon={<PlusIcon size={18} color={colors.onBrass} />}
              onPress={startSession}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      padded={false}
      motif="rings"
      header={
        <PageHeader title="Sessions" back={false} trailing={<SettingsButton />} />
      }
    >
      <FlatList
        data={entries}
        keyExtractor={(entry) => `${entry.away ? 'away' : 'own'}:${entry.session.id}`}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Button
              label="New Session"
              variant="primary"
              block
              icon={<PlusIcon size={18} color={colors.onBrass} />}
              onPress={startSession}
            />
          </View>
        }
        renderItem={({ item }) => (
          <SessionCard
            session={item.session}
            scoredBy={item.away ? scorerName(friends, item.away) : undefined}
            onPress={() =>
              router.push(item.away ? `/away/${item.session.id}` : `/session/${item.session.id}`)
            }
            onPlayAgain={() => {
              // A new session of your own either way. Playing again after a
              // night somebody else scored is how you become the one scoring.
              const session = createSessionLike(item.session);
              router.push(`/session/${session.id}`);
            }}
          />
        )}
      />
    </Screen>
  );
}

/** Whose phone kept score, by the name you know them by. */
function scorerName(friends: readonly Friend[], game: AwayGame): string {
  const owner = friends.find((friend) => friend.id === game.ownerId);
  return owner?.displayName || owner?.handle || 'a friend';
}

/**
 * One game on the list, yours or a friend's - the same card either way.
 *
 * `scoredBy` is the only difference, and it is a line rather than a different
 * shape: the standings, the rules and the hand count are what anybody opens
 * the list to see, and they mean the same whoever kept score.
 */
function SessionCard({
  session,
  scoredBy,
  onPress,
  onPlayAgain,
}: {
  session: Session;
  /** Set for a game somebody else scored: their name. */
  scoredBy?: string;
  onPress: () => void;
  onPlayAgain: () => void;
}) {
  const totals = sessionTotals(session);
  const rules = findRuleSet(session.ruleSetId);
  const ranked = [...session.players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));

  return (
    /*
     * The card holds two targets, so the body is the pressable rather than the
     * card: a button nested inside a pressable card works, but every tap near
     * its edge becomes a question about which one meant it.
     */
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          scoredBy ? `Open ${session.name}, scored by ${scoredBy}` : `Open ${session.name}`
        }
        onPress={onPress}
        style={({ pressed }) => [styles.cardBody, pressed && styles.cardPressed]}
      >
      <View style={styles.cardHeader}>
        <Heading numberOfLines={2} style={styles.cardTitle}>
          {session.name}
        </Heading>
        <Caption tone="faint">{relativeDate(session.updatedAt)}</Caption>
      </View>

      <Caption tone="faint" numberOfLines={1}>
        {rules?.name ?? 'Unknown rules'} · {plural(session.hands.length, 'hand')}
      </Caption>

      <View style={styles.standings}>
        {ranked.map((player) => {
          const total = totals[player.id] ?? 0;
          return (
            <View key={player.id} style={styles.standingRow}>
              <Body tone="muted" numberOfLines={1} style={styles.standingName}>
                {player.name}
              </Body>
              <CaptionStrong
                tone={total > 0 ? 'gain' : total < 0 ? 'loss' : 'faint'}
                numeric
              >
                {signed(total)}
              </CaptionStrong>
            </View>
          );
        })}
      </View>

      {scoredBy ? (
        <View style={styles.scoredBy}>
          <AwayIcon size={13} color={colors.inkFaint} />
          <Caption tone="faint">Scored by {scoredBy}</Caption>
        </View>
      ) : null}
      </Pressable>

      {/*
        * The one piece of setup starting a session cannot skip.
        *
        * Everything else about a new session has a sensible default and is a
        * tap to change on the table itself - but four names have to be typed,
        * and it is the same four every week. Carrying them over is the whole
        * feature; the scores and the deal deliberately stay behind, because
        * this is a new night rather than a continuation of the last one.
        */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Start a new session with ${ranked.map((p) => p.name).join(', ')}`}
        onPress={onPlayAgain}
        style={({ pressed }) => [styles.again, pressed && styles.againPressed]}
      >
        <PlayersIcon size={16} color={colors.inkMuted} />
        <CaptionStrong tone="muted">Play again, same players</CaptionStrong>
      </Pressable>
    </View>
  );
}

/**
 * Settings, in the corner of the first screen.
 *
 * It used to be a quarter of the tab bar, and it is one preference, two legal
 * links and a destructive button - with an icon of sliders sitting next to
 * Rules, also an icon of sliders. A gear in the corner is where every other
 * app keeps this, and it gives the fourth tab to something people open.
 */
function SettingsButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => router.push('/settings')}
      hitSlop={space.sm}
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <GearIcon size={22} color={colors.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gear: { padding: space.xs },
  pressed: { opacity: 0.6 },
  list: { paddingHorizontal: space.xl, paddingBottom: space.giant },
  header: { paddingTop: space.sm, paddingBottom: space.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  cardBody: { padding: space.lg, gap: space.xs },
  cardPressed: { backgroundColor: colors.surfaceHigh },
  again: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  againPressed: { backgroundColor: colors.surfaceHigh },
  scoredBy: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  cardTitle: { flex: 1 },
  standings: { marginTop: space.md, gap: space.xs },
  standingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  standingName: { flex: 1 },
});
