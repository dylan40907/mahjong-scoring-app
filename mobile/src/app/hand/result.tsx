import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Confetti,
  CountUp,
  Divider,
  EmptyState,
  Heading,
  Overline,
  Panel,
  Screen,
  Section,
  TileRow,
} from '@/design/components';
import { AlertIcon, CoinsIcon, MeldIcon, SparkIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { buildHandInput, resetDraft, useDraft } from '@/store/draft';
import {
  addHand,
  findRuleSet,
  makeId,
  updateHand,
  useAppState,
} from '@/store/store';
import type { HandRecord } from '@/store/types';
import { scoreHand, type HandContext } from '@/scoring';
import {  } from '@/lib/format';
import { computeDeltas } from '@/lib/settlement';
import { keepPhoto } from '@/lib/photos';

/**
 * The score, and how it was arrived at.
 *
 * The total is the largest thing on the screen and the breakdown is directly
 * under it, because the value of an automatic scorer is only partly the
 * arithmetic - the rest is settling the table's argument about which patterns
 * a hand contains. A number with no reasoning attached settles nothing.
 */
export default function ResultScreen() {
  const router = useRouter();
  const draft = useDraft(useCallback((d) => d, []));
  const settings = useAppState(useCallback((state) => state.settings, []));
  const session = useAppState(
    useCallback((state) => state.sessions.find((s) => s.id === draft.sessionId), [draft.sessionId]),
  );
  const rules = findRuleSet(draft.ruleSetId);

  const result = useMemo(() => {
    if (!rules) return null;
    const context = draft.context as HandContext;
    const input = buildHandInput(draft, context);
    if (!input) return null;
    return scoreHand(input, rules);
  }, [draft, rules]);

  // Every hook has to run on every render, so the "nothing to score" bail-out
  // waits until after them rather than short-circuiting above.
  const deltas = useMemo(() => {
    if (!session || !result?.settlement || !draft.winnerId) return {};
    return computeDeltas({
      players: session.players.map((p) => p.id),
      winnerId: draft.winnerId,
      discarderId: draft.discarderId,
      dealerId: session.dealerId,
      settlement: result.settlement,
    });
    // Depends on `result` rather than `result?.settlement`: React Compiler
    // cannot reason about an optional chain in a dependency array and bails out
    // of memoising the whole component when it sees one. `result` is itself a
    // useMemo output, so it is stable whenever its own inputs are.
  }, [session, result, draft.winnerId, draft.discarderId]);

  const save = async () => {
    if (!session || !draft.winnerId || !result?.settlement) return;
    const input = buildHandInput(draft, draft.context as HandContext);
    if (!input || !draft.winningTile) return;

    // Editing an existing hand keeps its id, so it replaces rather than joins.
    const handId = draft.handId ?? makeId('h');
    // The camera and picker both return cache URIs, which the system may clear
    // at any time. A saved hand keeps its own copy.
    const photoUri = draft.photoUri ? await keepPhoto(draft.photoUri, handId) : undefined;

    const record: HandRecord = {
      id: handId,
      createdAt: draft.createdAt ?? new Date().toISOString(),
      winnerId: draft.winnerId,
      discarderId: draft.discarderId,
      hand: {
        concealed: [...input.concealed],
        exposed: [...input.exposed],
        bonus: draft.bonus,
        winningTile: draft.winningTile,
        context: draft.context as HandContext,
      },
      deltas,
      summary: {
        total: result.total,
        unit: result.unit,
        winnerReceives: result.settlement.winnerReceives,
        limitName: result.limitName,
        topPatterns: result.patterns.slice(0, 3).map((p) => p.name),
      },
      photoUri,
    };
    if (draft.handId) updateHand(session.id, record);
    else addHand(session.id, record);
    if (settings.hapticsEnabled) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    resetDraft();
    router.dismissTo(`/session/${session.id}`);
  };

  if (!rules || !result) {
    return (
      <Screen>
        <EmptyState title="Nothing to score" body="Go back and finish entering the hand." />
      </Screen>
    );
  }

  if (!result.valid) {
    return (
      <Screen scroll footerSpace={0}>
        <Panel style={styles.invalid}>
          <AlertIcon size={26} color={colors.loss} />
          <Heading style={styles.invalidTitle}>This hand cannot be scored</Heading>
          <Body tone="muted" center>
            {result.reason}
          </Body>
        </Panel>
        <View style={styles.invalidActions}>
          <Button label="Go Back and Edit" block onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const winner = session?.players.find((p) => p.id === draft.winnerId);

  return (
    <Screen padded={false}>
      <Confetti active={result.total > 0} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headline}>
          <Overline>{rules.name.toUpperCase()}</Overline>
          <View style={styles.total}>
            <CountUp
              value={result.total}
              variant="display"
              tone="accent"
              suffix={result.unit}
            />
          </View>
          {result.limitName ? <Body tone="muted">{result.limitName}</Body> : null}
          {result.fu ? (
            <Caption tone="faint" numeric>
              {result.total} han · {result.fu.total} fu
            </Caption>
          ) : null}
        </View>

        {result.reading ? (
          <View style={styles.handDisplay}>
            <TileRow
              width={tileSize.sm}
              groups={result.reading.melds.map((meld) => meld.tiles.map((code) => code))}
            />
          </View>
        ) : null}

        <Section title="How it scores" icon={<SparkIcon size={15} color={colors.brass} />} first>
          <Panel flush>
            {result.patterns.map((pattern, index) => (
              <View key={pattern.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <View style={styles.pattern}>
                  <View style={styles.patternBody}>
                    <Body>{pattern.name}</Body>
                    {/* Wraps: a rule you cannot finish reading is not a rule
                        you can check the score against. */}
                    <Caption tone="faint">{pattern.description}</Caption>
                  </View>
                  <View style={styles.patternValue}>
                    {pattern.count > 1 ? (
                      <Caption tone="faint" numeric>
                        {pattern.count} × {pattern.unitValue}
                      </Caption>
                    ) : null}
                    <BodyStrong tone="accent" numeric>
                      {pattern.isLimit ? 'Limit' : `+${pattern.total}`}
                    </BodyStrong>
                  </View>
                </View>
              </View>
            ))}
          </Panel>
        </Section>

        {result.fu ? (
          <Section title="Minor points" icon={<MeldIcon size={15} color={colors.inkFaint} />}>
            <Panel flush>
              {result.fu.lines.map((line, index) => (
                <View key={`${line.label}-${index}`}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.fuLine}>
                    <Body tone="muted" style={styles.fuLabel}>
                      {line.label}
                    </Body>
                    <CaptionStrong numeric>+{line.fu}</CaptionStrong>
                  </View>
                </View>
              ))}
            </Panel>
          </Section>
        ) : null}

        <Section title="Settlement" icon={<CoinsIcon size={15} color={colors.inkFaint} />}>
          <Panel>
            <Body tone="muted">{result.settlement?.explanation}</Body>
            <View style={styles.settlement}>
              {result.settlement?.payments.map((payment) => (
                <View key={payment.label} style={styles.paymentRow}>
                  <Body tone="muted">{payment.label}</Body>
                  <BodyStrong tone="loss" numeric>
                    <CountUp value={-payment.amount} signed variant="caption" tone="loss" />
                  </BodyStrong>
                </View>
              ))}
              <Divider />
              <View style={styles.paymentRow}>
                <BodyStrong>{winner?.name ?? 'Winner'}</BodyStrong>
                <Heading tone="gain" numeric>
                  <CountUp
                    value={result.settlement?.winnerReceives ?? 0}
                    signed
                    variant="caption"
                    tone="gain"
                  />
                </Heading>
              </View>
            </View>
          </Panel>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={session ? 'Add to Session' : 'Done'}
          variant="primary"
          block
          onPress={session ? save : () => router.dismissTo('/')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  headline: { alignItems: 'center', paddingTop: space.xl, gap: space.xs },
  total: { marginTop: space.xs },
  handDisplay: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.well,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pattern: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  patternBody: { flex: 1, gap: 1 },
  patternValue: { alignItems: 'flex-end', gap: 1 },
  fuLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  fuLabel: { flex: 1 },
  settlement: { marginTop: space.lg, gap: space.md },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invalid: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, marginTop: space.xl },
  invalidTitle: { marginTop: space.xs },
  invalidActions: { marginTop: space.xl },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
