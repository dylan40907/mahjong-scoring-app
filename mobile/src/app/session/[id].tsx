import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { TrashIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import {
  allRuleSets,
  deleteHand,
  deleteSession,
  findRuleSet,
  renamePlayer,
  renameSession,
  sessionTotals,
  setSessionRuleSet,
  useAppState,
} from '@/store/store';
import { MahjongTable } from '@/components/MahjongTable';
import type { HandRecord, Session } from '@/store/types';
import { resetDraft } from '@/store/draft';
import { plural, relativeDate, scoreLabel } from '@/lib/format';

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

  /*
   * Above the not-found branch on purpose. Hooks have to run in the same order
   * on every render, and a session can disappear underneath this screen when it
   * is deleted from the list behind it.
   */
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [pickingRules, setPickingRules] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(session?.name ?? '');

  if (!session) {
    return (
      <Screen>
        <EmptyState title="Session not found" body="It may have been deleted from this device." />
      </Screen>
    );
  }

  const rules = findRuleSet(session.ruleSetId);
  const totals = sessionTotals(session);

  /**
   * Scoring starts from the person, not from a button.
   *
   * Tapping who won, then who fed the tile, is the whole question a hand poses
   * at the table, and it is answered in the order people actually say it out
   * loud. Both answers are things the scorer needs and neither can be read from
   * a photograph, so asking here means the review screen has nothing left to
   * ask about.
   */
  const startHand = (discarderId: string | null, selfDrawn: boolean) => {
    if (!winnerId) return;
    resetDraft({
      sessionId: session.id,
      ruleSetId: session.ruleSetId,
      winnerId,
      discarderId,
      context: { selfDrawn },
    });
    setWinnerId(null);
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
      {/*
        * The name lives in the page, not the bar: it is editable there, and
        * showing it in both places said the same thing twice.
        */}
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {editingTitle ? (
          <TextInput
            value={titleText}
            onChangeText={setTitleText}
            onBlur={() => {
              renameSession(session.id, titleText.trim() || session.name);
              setEditingTitle(false);
            }}
            onSubmitEditing={() => {
              renameSession(session.id, titleText.trim() || session.name);
              setEditingTitle(false);
            }}
            autoFocus
            selectTextOnFocus
            style={styles.titleInput}
            maxLength={40}
            accessibilityLabel="Session name"
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rename ${session.name}`}
            onPress={() => {
              setTitleText(session.name);
              setEditingTitle(true);
            }}
          >
            <Title>{session.name}</Title>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change the rules"
          onPress={() => setPickingRules(!pickingRules)}
        >
          <Caption tone="faint" style={styles.subtitle}>
            {rules?.name ?? 'Unknown rules'} · change
          </Caption>
        </Pressable>

        {pickingRules ? (
          <View style={styles.ruleChips}>
            {allRuleSets().map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                onPress={() => {
                  setSessionRuleSet(session.id, option.id);
                  setPickingRules(false);
                }}
                style={({ pressed }) => [
                  styles.ruleChip,
                  option.id === session.ruleSetId && styles.ruleChipOn,
                  pressed && styles.pressedChip,
                ]}
              >
                <Caption tone={option.id === session.ruleSetId ? 'accent' : 'muted'}>
                  {option.name}
                </Caption>
              </Pressable>
            ))}
          </View>
        ) : null}

        <MahjongTable
          players={session.players}
          totals={totals}
          dealerId={session.dealerId}
          roundWind={session.roundWind}
          handCount={session.hands.length}
          selectedId={winnerId}
          onSelect={(id) => setWinnerId(id === winnerId ? null : id)}
          onRename={(playerId, name) => renamePlayer(session.id, playerId, name)}
        />

        {winnerId ? (
          <Panel style={styles.askPanel}>
            <CaptionStrong>
              {session.players.find((p) => p.id === winnerId)?.name} won. Who discarded?
            </CaptionStrong>
            <View style={styles.ruleChips}>
              {session.players
                .filter((player) => player.id !== winnerId)
                .map((player) => (
                  <Pressable
                    key={player.id}
                    accessibilityRole="button"
                    onPress={() => startHand(player.id, false)}
                    style={({ pressed }) => [styles.ruleChip, pressed && styles.pressedChip]}
                  >
                    <Caption tone="muted">{player.name}</Caption>
                  </Pressable>
                ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => startHand(null, true)}
                style={({ pressed }) => [
                  styles.ruleChip,
                  styles.ruleChipOn,
                  pressed && styles.pressedChip,
                ]}
              >
                <Caption tone="accent">Self-drawn</Caption>
              </Pressable>
            </View>
          </Panel>
        ) : null}

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

    </Screen>
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
  titleInput: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.brass,
  },
  ruleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: space.xs,
  },
  ruleChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  ruleChipOn: { borderColor: colors.brass, backgroundColor: colors.brassWash },
  pressedChip: { backgroundColor: colors.surfaceHigh },
  askPanel: { marginTop: space.sm, gap: space.xs, padding: space.md },
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
