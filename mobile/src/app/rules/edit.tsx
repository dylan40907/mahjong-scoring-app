import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Panel,
  Screen,
  Section,
  Segmented,
  Stepper,
  TextField,
} from '@/design/components';
import { CheckIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import {
  BUILT_IN_RULESETS,
  PATTERN_LIST,
  type CustomRuleSet,
  type PatternValue,
  type RuleSet,
} from '@/scoring';
import { findRuleSet, makeId, saveCustomRuleSet, useAppState } from '@/store/store';

/**
 * The custom ruleset editor.
 *
 * Rulesets are built by divergence, not from nothing: pick the table you are
 * closest to and change what differs. That is how house rules actually work -
 * nobody invents a scoring system, they inherit one and argue about six values
 * in it - and starting from a blank list of ninety patterns would be a far
 * worse experience than starting from a preset that is already nearly right.
 */
export default function RuleEditorScreen() {
  const router = useRouter();
  const { base, id } = useLocalSearchParams<{ base?: string; id?: string }>();
  useAppState(useCallback((state) => state.customRuleSets, []));

  const existing = id ? (findRuleSet(id) as CustomRuleSet | undefined) : undefined;
  const source = existing ?? findRuleSet(base ?? '') ?? BUILT_IN_RULESETS[0];

  const [name, setName] = useState(existing?.name ?? `${source.name} (mine)`);
  const [patterns, setPatterns] = useState<Record<string, PatternValue>>({ ...source.patterns });
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const unit = unitAbbrev(source.payout.model);

  const rows = useMemo(() => {
    const list = PATTERN_LIST.map((definition) => ({
      definition,
      value: patterns[definition.id],
    }));
    return filter === 'active' ? list.filter((row) => row.value !== undefined) : list;
  }, [patterns, filter]);

  const setValue = (patternId: string, next: number) => {
    setPatterns((current) => ({
      ...current,
      [patternId]: { ...(current[patternId] ?? { value: 0 }), value: next },
    }));
  };

  const toggle = (patternId: string) => {
    setPatterns((current) => {
      const copy = { ...current };
      if (copy[patternId]) delete copy[patternId];
      else copy[patternId] = { value: 1 };
      return copy;
    });
  };

  const save = () => {
    const now = new Date().toISOString();
    const ruleSet: CustomRuleSet = {
      ...(source as RuleSet),
      id: existing?.id ?? makeId('rules'),
      name: name.trim() || 'Custom rules',
      subtitle: `${source.handSize} tiles · based on ${source.name}`,
      family: 'custom',
      patterns,
      builtIn: false,
      derivedFrom: existing?.derivedFrom ?? source.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notes: `Started from ${source.name} and adjusted.`,
    };
    saveCustomRuleSet(ruleSet);
    router.back();
  };

  const activeCount = Object.keys(patterns).length;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: existing ? 'Edit Ruleset' : 'New Ruleset' }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Section title="Name" first>
          <TextField value={name} onChangeText={setName} placeholder="My table's rules" />
        </Section>

        <Section title="Based on">
          <Panel>
            <BodyStrong>{source.name}</BodyStrong>
            <Caption tone="faint" style={styles.baseNote}>
              {source.handSize} tiles, counted in {unitName(source.payout.model)}. The hand size and
              payout model come from the preset; the pattern values below are yours to change.
            </Caption>
          </Panel>
        </Section>

        <Section title="Patterns" note={`${activeCount} active`}>
          <Segmented
            options={[
              { value: 'active', label: 'In use' },
              { value: 'all', label: 'Everything' },
            ]}
            value={filter}
            onChange={setFilter}
            style={styles.filter}
          />
          <Panel flush style={styles.patternList}>
            {rows.map((row, index) => {
              const enabled = row.value !== undefined;
              const isLimit = row.value?.limit !== undefined;
              return (
                <View key={row.definition.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.pattern}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: enabled }}
                      onPress={() => toggle(row.definition.id)}
                      style={styles.patternBody}
                    >
                      <Body tone={enabled ? 'default' : 'faint'}>{row.definition.name}</Body>
                      <Caption tone="faint">
                        {row.definition.description}
                      </Caption>
                    </Pressable>
                    {enabled ? (
                      isLimit ? (
                        <CaptionStrong tone="accent">Limit</CaptionStrong>
                      ) : (
                        <View style={styles.stepperWrap}>
                          <Stepper
                            value={row.value!.value}
                            min={0}
                            max={200}
                            onChange={(next) => setValue(row.definition.id, next)}
                          />
                          <Caption tone="faint">{unit}</Caption>
                        </View>
                      )
                    ) : (
                      <Caption tone="faint">Off</Caption>
                    )}
                  </View>
                </View>
              );
            })}
          </Panel>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Save Ruleset"
          variant="primary"
          block
          icon={<CheckIcon size={18} color={colors.onBrass} />}
          onPress={save}
        />
      </View>
    </Screen>
  );
}

function unitName(model: string): string {
  switch (model) {
    case 'tai':
      return 'tai';
    case 'faan':
      return 'faan';
    case 'riichi':
      return 'han and fu';
    default:
      return 'points';
  }
}

function unitAbbrev(model: string): string {
  return model === 'riichi' ? 'han' : model === 'tai' ? 'tai' : model === 'faan' ? 'faan' : 'pts';
}

const styles = StyleSheet.create({
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  baseNote: { marginTop: space.xs },
  filter: { marginBottom: space.md },
  patternList: { paddingVertical: 0 },
  pattern: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  patternBody: { flex: 1, gap: 1 },
  stepperWrap: { alignItems: 'center', gap: 2 },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
