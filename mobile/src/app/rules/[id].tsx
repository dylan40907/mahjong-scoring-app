import React, { useCallback, useMemo } from 'react';
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
  Row,
  Screen,
  Section,
} from '@/design/components';
import { EditIcon, PlusIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { PATTERNS, describeCustomHand, type PatternValue } from '@/scoring';
import { deleteCustomRuleSet, findRuleSet, useAppState } from '@/store/store';

/**
 * A ruleset, laid out in full.
 *
 * Showing every pattern and its value is the point rather than a detail: what
 * distinguishes one table's Taiwanese from another's is exactly this list, and
 * an app that scored hands without letting anyone read the rules it used would
 * be asking to be trusted rather than checked.
 */
export default function RuleSetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  useAppState(useCallback((state) => state.customRuleSets, []));
  const rules = findRuleSet(id ?? '');

  const grouped = useMemo(() => {
    if (!rules) return [];
    const entries = Object.entries(rules.patterns)
      .map(([patternId, value]) => ({ patternId, value, definition: PATTERNS.get(patternId) }))
      .filter((entry) => entry.definition !== undefined);

    const own = new Set((rules.customHands ?? []).map((hand) => hand.id));
    const limits = entries.filter((e) => e.value.limit !== undefined && !own.has(e.patternId));
    const scoring = entries
      .filter((e) => e.value.limit === undefined && !own.has(e.patternId))
      .sort((a, b) => b.value.value - a.value.value || a.definition!.name.localeCompare(b.definition!.name));

    return [
      { title: 'Limit hands', entries: limits },
      { title: 'Scoring patterns', entries: scoring },
    ].filter((group) => group.entries.length > 0);
  }, [rules]);

  if (!rules) {
    return (
      <Screen>
        <EmptyState title="Ruleset not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const confirmDelete = () => {
    Alert.alert('Delete this ruleset?', `${rules.name} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCustomRuleSet(rules.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: rules.name }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {rules.notes ? (
          <Body tone="muted" style={styles.notes}>
            {rules.notes}
          </Body>
        ) : null}

        <Section title="How it plays" first>
          <Panel flush>
            <Row title="Hand size" value={`${rules.handSize} tiles`} />
            <Divider inset={space.lg} />
            <Row title="Counted in" value={unitName(rules.payout.model)} />
            <Divider inset={space.lg} />
            <Row title="Flowers and seasons" value={rules.usesBonusTiles ? 'In play' : 'Not used'} />
            <Divider inset={space.lg} />
            <Row title="Seven pairs" value={rules.allowSevenPairs ? 'Allowed' : 'Not allowed'} />
            <Divider inset={space.lg} />
            <Row
              title="Thirteen orphans"
              value={rules.allowThirteenOrphans ? 'Allowed' : 'Not allowed'}
            />
            {rules.requiresYaku ? (
              <>
                <Divider inset={space.lg} />
                <Row title="Named pattern required" value="Yes" />
              </>
            ) : null}
            {rules.payout.model === 'tai' ? (
              <>
                <Divider inset={space.lg} />
                <Row title="Base (底)" value={String(rules.payout.base)} />
                <Divider inset={space.lg} />
                <Row title="Per tai (台)" value={String(rules.payout.perTai)} />
                {rules.payout.maxTai > 0 ? (
                  <>
                    <Divider inset={space.lg} />
                    <Row title="Capped at" value={`${rules.payout.maxTai} tai`} />
                  </>
                ) : null}
              </>
            ) : null}
            {rules.payout.model === 'faan' && rules.payout.minimumFaan > 0 ? (
              <>
                <Divider inset={space.lg} />
                <Row title="Minimum" value={`${rules.payout.minimumFaan} faan`} />
              </>
            ) : null}
            {rules.payout.model === 'mcr' ? (
              <>
                <Divider inset={space.lg} />
                <Row title="Minimum" value={`${rules.payout.minimumPoints} points`} />
              </>
            ) : null}
          </Panel>
        </Section>

        {/*
          * Hands this table made up, listed before the library's.
          *
          * They are the reason somebody built a custom ruleset at all, and
          * burying them among ninety built-in patterns - where they sort by
          * value like everything else - hid the one part that is theirs.
          */}
        {(rules.customHands ?? []).length > 0 ? (
          <Section title="Hands this table plays" note={`${rules.customHands!.length}`}>
            <Panel flush>
              {rules.customHands!.map((hand, index) => (
                <View key={hand.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.pattern}>
                    <View style={styles.patternBody}>
                      <Body>{hand.name}</Body>
                      <Caption tone="faint">{hand.description}</Caption>
                      <Caption tone="muted">{describeCustomHand(hand)}</Caption>
                    </View>
                    {rules.patterns[hand.id] ? (
                      <PatternValueLabel
                        value={rules.patterns[hand.id]}
                        unit={unitAbbrev(rules.payout.model)}
                      />
                    ) : (
                      <Caption tone="faint">Off</Caption>
                    )}
                  </View>
                </View>
              ))}
            </Panel>
          </Section>
        ) : null}

        {grouped.map((group) => (
          <Section key={group.title} title={group.title} note={`${group.entries.length}`}>
            <Panel flush>
              {group.entries.map((entry, index) => (
                <View key={entry.patternId}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.pattern}>
                    <View style={styles.patternBody}>
                      <Body>{entry.definition!.name}</Body>
                      <Caption tone="faint">{entry.definition!.description}</Caption>
                    </View>
                    <PatternValueLabel value={entry.value} unit={unitAbbrev(rules.payout.model)} />
                  </View>
                </View>
              ))}
            </Panel>
          </Section>
        ))}

        <Section title={rules.builtIn ? 'Make it yours' : 'This ruleset'}>
          <View style={styles.actions}>
            <Button
              label={rules.builtIn ? 'Duplicate and Edit' : 'Edit'}
              block
              icon={
                rules.builtIn ? (
                  <PlusIcon size={18} color={colors.ink} />
                ) : (
                  <EditIcon size={18} color={colors.ink} />
                )
              }
              onPress={() =>
                router.push(
                  rules.builtIn ? `/rules/edit?base=${rules.id}` : `/rules/edit?id=${rules.id}`,
                )
              }
            />
            {!rules.builtIn ? (
              <Button label="Delete ruleset" variant="danger" block onPress={confirmDelete} />
            ) : null}
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}

function PatternValueLabel({ value, unit }: { value: PatternValue; unit: string }) {
  if (value.limit !== undefined) {
    return (
      <CaptionStrong tone="accent">{value.limit > 1 ? `${value.limit}× limit` : 'Limit'}</CaptionStrong>
    );
  }
  const open = value.openValue !== undefined && value.openValue !== value.value;
  return (
    <View style={styles.valueColumn}>
      <BodyStrong tone="accent" numeric>
        {value.value} {unit}
      </BodyStrong>
      {open ? (
        <Caption tone="faint" numeric>
          {value.openValue} open
        </Caption>
      ) : value.concealedOnly ? (
        <Caption tone="faint">concealed only</Caption>
      ) : null}
    </View>
  );
}

function unitName(model: string): string {
  switch (model) {
    case 'tai':
      return 'Tai (台)';
    case 'faan':
      return 'Faan (番)';
    case 'riichi':
      return 'Han and fu';
    default:
      return 'Points';
  }
}

function unitAbbrev(model: string): string {
  switch (model) {
    case 'tai':
      return 'tai';
    case 'faan':
      return 'faan';
    case 'riichi':
      return 'han';
    default:
      return 'pts';
  }
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingBottom: space.huge },
  notes: { marginTop: space.md },
  pattern: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  patternBody: { flex: 1, gap: 1 },
  valueColumn: { alignItems: 'flex-end', gap: 1, minWidth: 72 },
  actions: { gap: space.sm },
});
