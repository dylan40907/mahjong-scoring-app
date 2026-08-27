import React, { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  EmptyState,
  Panel,
  Screen,
  Section,
  Title,
} from '@/design/components';
import { CameraIcon, TrashIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import { deleteHand, deleteSession, findRuleSet, sessionTotals, useAppState } from '@/store/store';
import type { HandRecord, Session, SessionPlayer } from '@/store/types';
import { resetDraft } from '@/store/draft';
import { plural, relativeDate, scoreLabel, signed, WIND_GLYPH, WIND_LABEL } from '@/lib/format';

/**
 * A session in progress.
 *
 * The standings sit at the top at display size: this is the number people look
 * up between hands, and it should be readable across a table without picking
 * the phone up. The current dealer is marked because it is the one piece of
 * game state that is easy to lose track of and annoying to reconstruct.
 */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useAppState(
    useCallback((state) => state.sessions.find((s) => s.id === id), [id]),
  );

  if (!session) {
    return (
      <Screen>
        <EmptyState title="Session not found" body="It may have been deleted from this device." />
      </Screen>
    );
  }

  const rules = findRuleSet(session.ruleSetId);
  const totals = sessionTotals(session);
  const ranked = [...session.players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));

  const startHand = () => {
    resetDraft({ sessionId: session.id, ruleSetId: session.ruleSetId });
    router.push('/hand/capture');
  };

  const confirmDelete = () => {
    Alert.alert('Delete this session?', `${session.name} and its ${plural(session.hands.length, 'hand')} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteSession(session.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: session.name }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Caption tone="faint" style={styles.subtitle}>
          {rules?.name ?? 'Unknown rules'} · {WIND_LABEL[session.roundWind]} round
        </Caption>

        <Section title="Standings" first>
          <Panel flush>
            {ranked.map((player, index) => (
              <View key={player.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <StandingRow
                  player={player}
                  total={totals[player.id] ?? 0}
                  isDealer={player.id === session.dealerId}
                />
              </View>
            ))}
          </Panel>
        </Section>

        <Section title={`Hands`} note={session.hands.length > 0 ? plural(session.hands.length, 'hand') : undefined}>
          {session.hands.length === 0 ? (
            <Panel style={styles.emptyPanel}>
              <Body tone="muted" center>
                No hands scored yet.
              </Body>
              <Caption tone="faint" center style={styles.emptyNote}>
                Photograph a winning hand and the tiles will be read for you.
              </Caption>
            </Panel>
          ) : (
            <Panel flush>
              {session.hands.map((hand, index) => (
                <View key={hand.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <HandRow
                    hand={hand}
                    session={session}
                    onDelete={() => deleteHand(session.id, hand.id)}
                  />
                </View>
              ))}
            </Panel>
          )}
        </Section>

        <Section title="Session">
          <Button label="Delete session" variant="danger" block onPress={confirmDelete} />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Score a Hand"
          variant="primary"
          block
          icon={<CameraIcon size={18} color={colors.onBrass} />}
          onPress={startHand}
        />
      </View>
    </Screen>
  );
}

function StandingRow({
  player,
  total,
  isDealer,
}: {
  player: SessionPlayer;
  total: number;
  isDealer: boolean;
}) {
  return (
    <View style={styles.standing}>
      <View style={styles.seat}>
        <Caption tone={isDealer ? 'accent' : 'faint'}>{WIND_GLYPH[player.seat]}</Caption>
      </View>
      <View style={styles.standingBody}>
        <Body numberOfLines={1}>{player.name}</Body>
        {isDealer ? <Caption tone="accent">Dealing</Caption> : null}
      </View>
      <Title tone={total > 0 ? 'gain' : total < 0 ? 'loss' : 'faint'} numeric>
        {signed(total)}
      </Title>
    </View>
  );
}

function HandRow({
  hand,
  session,
  onDelete,
}: {
  hand: HandRecord;
  session: Session;
  onDelete: () => void;
}) {
  const winner = session.players.find((p) => p.id === hand.winnerId);
  const discarder = session.players.find((p) => p.id === hand.discarderId);

  const how = hand.discarderId === null
    ? 'Self-drawn'
    : `Discarded by ${discarder?.name ?? 'someone'}`;

  const confirm = () => {
    Alert.alert('Remove this hand?', 'The standings will be recalculated.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <View style={styles.hand}>
      <View style={styles.handBody}>
        <View style={styles.handHeader}>
          <BodyStrong numberOfLines={1} style={styles.handWinner}>
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
          <Caption tone="muted" numberOfLines={1} style={styles.patterns}>
            {hand.summary.topPatterns.join(' · ')}
          </Caption>
        ) : null}
      </View>
      <Button label="" variant="ghost" onPress={confirm} icon={<TrashIcon size={18} color={colors.inkFaint} />} style={styles.handDelete} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  subtitle: { marginTop: -space.xs },
  standing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 58,
  },
  seat: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standingBody: { flex: 1, gap: 1 },
  emptyPanel: { paddingVertical: space.xxl },
  emptyNote: { marginTop: space.xs },
  hand: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs },
  handBody: { flex: 1, gap: 2, paddingVertical: space.md },
  handHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  handWinner: { flex: 1 },
  patterns: { marginTop: 1 },
  handDelete: { minHeight: 40, paddingHorizontal: space.md },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
