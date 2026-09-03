import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ColorValue,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
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
  ChoiceGrid,
  TileFace,
} from '@/design/components';
import { DiscardIcon, HistoryIcon, PlayersIcon, SelfDrawIcon, TrashIcon } from '@/design/icons';
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
import { editHand, resetDraft } from '@/store/draft';
import { discardPhoto } from '@/lib/photos';
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
    const winner = session.players.find((player) => player.id === winnerId);
    if (!winnerId || !winner) return;
    resetDraft({
      sessionId: session.id,
      ruleSetId: session.ruleSetId,
      winnerId,
      discarderId,
      /*
       * The whole scoring context, settled here rather than on a screen of
       * its own.
       *
       * Who won and where the tile came from are the only two things anyone
       * says out loud at the table, and the seat, the round and the deal all
       * follow from the winner. That left the old circumstances screen with
       * nothing to ask that mattered on an ordinary hand - it was a step that
       * existed to hold a list nobody needed - so what remains of it now sits
       * above the camera as one closed expander.
       */
      context: {
        selfDrawn,
        seatWind: winner.seat,
        roundWind: session.roundWind,
        isDealer: session.dealerId === winnerId,
        // How long the deal has been held, which Taiwanese tables price on
        // both sides: the dealer's hand is worth more, and so is dealing in.
        dealerStreak: session.dealerStreak ?? 0,
      },
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
          dealerStreak={session.dealerStreak ?? 0}
          roundWind={session.roundWind}
          handCount={session.hands.length}
          selectedId={winnerId}
          onSelect={(id) => setWinnerId(id === winnerId ? null : id)}
          onRename={(playerId, name) => renamePlayer(session.id, playerId, name)}
        />

        {/*
          * Where the winning tile came from, asked as four faces rather than
          * as a sentence and a row of name chips.
          *
          * Each opponent is shown by their seat tile, which is the same mark
          * they carry on the table above, so the answer is a picture of the
          * person's seat rather than a name to read. Self-draw gets the
          * drawing of a tile coming off the wall - the one option that is not
          * a person, and the one whose name is hardest to translate.
          */}
        {winnerId ? (
          <Panel style={styles.askPanel}>
            <View style={styles.askHead}>
              <DiscardIcon size={18} color={colors.inkFaint} />
              <CaptionStrong tone="muted">Winning tile came from</CaptionStrong>
            </View>
            <ChoiceGrid
              columns={2}
              items={[
                ...session.players
                  .filter((player) => player.id !== winnerId)
                  .map((player) => ({
                    key: player.id,
                    label: player.name,
                    icon: () => <TileFace code={player.seat} width={22} />,
                    onPress: () => startHand(player.id, false),
                  })),
                {
                  key: 'self-draw',
                  label: 'Self-draw',
                  icon: (color: ColorValue) => <SelfDrawIcon size={24} color={color} />,
                  onPress: () => startHand(null, true),
                },
              ]}
            />
          </Panel>
        ) : null}

        <Section
          title="Hands"
          icon={<HistoryIcon size={15} color={colors.inkFaint} />}
          note={session.hands.length > 0 ? plural(session.hands.length, 'hand') : undefined}
        >
          {session.hands.length === 0 ? (
            <Panel style={styles.emptyPanel}>
              <PlayersIcon size={26} color={colors.inkFaint} />
              <Caption tone="faint" center style={styles.emptyNote}>
                Tap whoever won
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
                    onDelete={() => {
                      void discardPhoto(hand.photoUri);
                      deleteHand(session.id, hand.id);
                    }}
                    onEdit={() => {
                      // Straight to the tiles: the photograph and everything
                      // read from it are already known, so there is nothing to
                      // capture unless the user asks to retake it.
                      editHand(hand, session.id, session.ruleSetId);
                      router.push('/hand/review');
                    }}
                  />
                </View>
              ))}
            </Panel>
          )}
        </Section>

        <Section title="Session" icon={<PlayersIcon size={15} color={colors.inkFaint} />}>
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
  onEdit,
}: {
  hand: HandRecord;
  session: Session;
  onDelete: () => void;
  onEdit: () => void;
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
      {/*
        * The body opens the hand; only the bin deletes it. A scored hand is the
        * one thing in the app that could previously not be corrected, which
        * made every misread tile permanent.
        */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit the hand ${winner?.name ?? ''} won`}
        onPress={onEdit}
        style={({ pressed }) => [styles.handBody, pressed && styles.pressedChip]}
      >
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
          /* Wraps. This is the one line that says *why* the hand was worth
             what it was worth, and it was reliably the line that got cut. */
          <Caption tone="muted" style={styles.patterns}>
            {hand.summary.topPatterns.join(' · ')}
          </Caption>
        ) : null}
      </Pressable>
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
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
