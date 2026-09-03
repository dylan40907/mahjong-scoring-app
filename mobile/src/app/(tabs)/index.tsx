import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Body,
  Caption,
  CaptionStrong,
  Button,
  EmptyState,
  Heading,
  Screen,
} from '@/design/components';
import { PlayersIcon, PlusIcon, SessionsIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import {
  createQuickSession,
  createSessionLike,
  findRuleSet,
  sessionTotals,
  useAppState,
} from '@/store/store';
import type { Session } from '@/store/types';
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
  const ready = useAppState(useCallback((state) => state.ready, []));

  if (ready && sessions.length === 0) {
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
    <Screen padded={false}>
      <FlatList
        data={sessions}
        keyExtractor={(session) => session.id}
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
            session={item}
            onPress={() => router.push(`/session/${item.id}`)}
            onPlayAgain={() => {
              const session = createSessionLike(item);
              router.push(`/session/${session.id}`);
            }}
          />
        )}
      />
    </Screen>
  );
}

function SessionCard({
  session,
  onPress,
  onPlayAgain,
}: {
  session: Session;
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
        accessibilityLabel={`Open ${session.name}`}
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

const styles = StyleSheet.create({
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
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  cardTitle: { flex: 1 },
  standings: { marginTop: space.md, gap: space.xs },
  standingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  standingName: { flex: 1 },
});
