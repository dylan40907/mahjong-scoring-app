import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  BodyStrong,
  Button,
  Caption,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
  Stepper,
  Toggle,
} from '@/design/components';
import { colors, space } from '@/design/tokens';
import type { HandContext } from '@/scoring';
import { findRuleSet, useAppState } from '@/store/store';
import { updateDraft, useDraft } from '@/store/draft';
import { WIND_LABEL } from '@/lib/format';

/**
 * The half of a hand that a photograph cannot show.
 *
 * Who won, whether the tile was drawn or claimed, and which of a dozen
 * situational bonuses applied are all invisible to the camera, and several of
 * them are worth more than the tiles. The questions are filtered by ruleset:
 * asking a Taiwanese player about riichi, or a Riichi player about flowers,
 * is how a scoring app ends up feeling like a form.
 */
export default function HandContextScreen() {
  const router = useRouter();
  const draft = useDraft(useCallback((d) => d, []));
  const session = useAppState(
    useCallback((state) => state.sessions.find((s) => s.id === draft.sessionId), [draft.sessionId]),
  );
  const rules = findRuleSet(draft.ruleSetId);
  const family = rules?.family ?? 'taiwanese';

  const players = session?.players ?? [];
  const winnerId = draft.winnerId;
  const discarderId = draft.discarderId;
  const selfDrawn = draft.context.selfDrawn ?? false;
  const [flags, setFlags] = useState<Partial<HandContext>>(draft.context);

  const winner = players.find((p) => p.id === winnerId);
  const discarder = players.find((p) => p.id === discarderId);

  const setFlag = <K extends keyof HandContext>(key: K, value: HandContext[K]) =>
    setFlags((current) => ({ ...current, [key]: value }));

  const ready = winnerId !== null && (selfDrawn || discarderId !== null);

  const proceed = () => {
    if (!winnerId || !session || !winner) return;
    const context: HandContext = {
      ...flags,
      selfDrawn,
      seatWind: winner.seat,
      roundWind: session.roundWind,
      isDealer: session.dealerId === winnerId,
    };
    updateDraft({
      winnerId,
      discarderId: selfDrawn ? null : discarderId,
      context,
    });
    router.push('/hand/capture');
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/*
          * Who won and how the tile came are settled at the table, before the
          * photograph, because that is the order people say them out loud. They
          * are shown here as a statement rather than asked again - being asked
          * twice reads as the app not having listened.
          */}
        <Section title="The hand" first>
          <Panel style={styles.recap}>
            <BodyStrong>
              {winner?.name ?? 'Someone'} won
              {selfDrawn
                ? ', self-drawn'
                : discarder
                  ? `, on ${discarder.name}'s discard`
                  : ''}
            </BodyStrong>
            <Caption tone="faint">
              Seated {WIND_LABEL[winner?.seat ?? 'east']}
              {session?.dealerId === winner?.id ? ' · dealing' : ''} ·{' '}
              {WIND_LABEL[session?.roundWind ?? 'east']} round
            </Caption>
          </Panel>
        </Section>

        {family === 'riichi' ? (
          <Section title="Declarations">
            <Panel flush>
              <Toggle
                label="Riichi"
                hint="Declared ready with a concealed hand."
                value={flags.riichi ?? false}
                onChange={(value) => setFlag('riichi', value)}
              />
              <Divider inset={space.lg} />
              <Toggle
                label="Double riichi"
                hint="Declared on the very first discard."
                value={flags.doubleRiichi ?? false}
                onChange={(value) => setFlag('doubleRiichi', value)}
              />
              <Divider inset={space.lg} />
              <Toggle
                label="Ippatsu"
                hint="Won within one go-around of declaring."
                value={flags.ippatsu ?? false}
                onChange={(value) => setFlag('ippatsu', value)}
              />
              <Divider inset={space.lg} />
              <Row
                title="Dora"
                subtitle="Bonus tiles, including red fives and ura-dora."
                trailing={
                  <Stepper
                    value={flags.dora ?? 0}
                    min={0}
                    max={12}
                    onChange={(value) => setFlag('dora', value)}
                  />
                }
              />
            </Panel>
          </Section>
        ) : null}

        <Section title="Circumstances">
          <Panel flush>
            <Toggle
              label="Last tile of the wall"
              hint="Self-drawn as the wall ran out."
              value={flags.lastTileFromWall ?? false}
              onChange={(value) => setFlag('lastTileFromWall', value)}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="Final discard"
              hint="Claimed the last discard of the hand."
              value={flags.lastDiscard ?? false}
              onChange={(value) => setFlag('lastDiscard', value)}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="After a kong"
              hint="Won on the replacement tile."
              value={flags.afterKong ?? false}
              onChange={(value) => setFlag('afterKong', value)}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="Robbed a kong"
              hint="Claimed the tile another player was adding to a triplet."
              value={flags.robbingKong ?? false}
              onChange={(value) => setFlag('robbingKong', value)}
            />
            {family === 'mcr' ? (
              <>
                <Divider inset={space.lg} />
                <Toggle
                  label="Last tile of its kind"
                  hint="The other three copies were already visible."
                  value={flags.lastTileOfKind ?? false}
                  onChange={(value) => setFlag('lastTileOfKind', value)}
                />
              </>
            ) : null}
          </Panel>
        </Section>

        {family === 'taiwanese' ? (
          <Section title="Speed of the hand">
            <Panel flush>
              <Row
                title="Discards before the win"
                subtitle="Some tables pay a bonus for an early win."
                trailing={
                  <Stepper
                    value={flags.discardsBeforeWin ?? 20}
                    min={0}
                    max={40}
                    onChange={(value) => setFlag('discardsBeforeWin', value)}
                  />
                }
              />
              <Divider inset={space.lg} />
              <Toggle
                label="Ready on the deal"
                hint="One tile from winning before the first draw."
                value={flags.readyOnDeal ?? false}
                onChange={(value) => setFlag('readyOnDeal', value)}
              />
            </Panel>
          </Section>
        ) : null}

        <Section title="Exceptional">
          <Panel flush>
            <Toggle
              label="Won on the dealt hand"
              hint="The dealer's hand was already complete."
              value={flags.heavenly ?? false}
              onChange={(value) => setFlag('heavenly', value)}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="Won on the dealer's first discard"
              value={flags.earthly ?? false}
              onChange={(value) => setFlag('earthly', value)}
            />
          </Panel>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Photograph the Hand"
          variant="primary"
          block
          disabled={!ready}
          onPress={proceed}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  recap: { gap: space.xxs },
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { marginTop: space.md, paddingHorizontal: space.xs },
  discarder: { marginTop: space.lg, gap: space.sm },
  discarderLabel: { paddingHorizontal: space.xs },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
