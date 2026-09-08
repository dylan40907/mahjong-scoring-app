import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Caption, Divider, Panel, Row, Screen, Section, Button } from '@/design/components';
import { PlusIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { BUILT_IN_RULESETS, type RuleFamily, type RuleSet } from '@/scoring';
import { useAppState } from '@/store/store';

/**
 * The ruleset library.
 *
 * Grouped by family rather than listed flat, because the first decision is
 * which game you are playing and only the second is which table's numbers to
 * use. The two Taiwanese entries sitting side by side is the point: it makes
 * the variation visible instead of hiding it behind one canonical "Taiwanese".
 */

const FAMILY_ORDER: RuleFamily[] = ['taiwanese', 'hongkong', 'riichi', 'mcr', 'custom'];

const FAMILY_LABEL: Record<RuleFamily, string> = {
  taiwanese: 'Taiwanese · 16 tiles',
  hongkong: 'Hong Kong · 13 tiles',
  riichi: 'Japanese Riichi · 13 tiles',
  mcr: 'Chinese Official · 13 tiles',
  custom: 'Your rules',
};

export default function RulesScreen() {
  const router = useRouter();
  const custom = useAppState(useCallback((state) => state.customRuleSets, []));

  const grouped = useMemo(() => {
    const all: RuleSet[] = [...BUILT_IN_RULESETS, ...custom];
    const map = new Map<RuleFamily, RuleSet[]>();
    for (const rules of all) {
      const family = rules.builtIn ? rules.family : 'custom';
      map.set(family, [...(map.get(family) ?? []), rules]);
    }
    return map;
  }, [custom]);

  return (
    <Screen scroll motif="wall">
      <Body tone="muted" style={styles.intro}>
        Every table counts differently. Pick a preset, or build your own.
      </Body>

      {FAMILY_ORDER.map((family) => {
        const entries = grouped.get(family);
        if (family === 'custom' && !entries?.length) return null;
        if (!entries?.length) return null;

        return (
          <Section key={family} title={FAMILY_LABEL[family]}>
            <Panel flush>
              {entries.map((rules, index) => (
                <View key={rules.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <Row
                    title={rules.name}
                    subtitle={rules.subtitle}
                    onPress={() => router.push(`/rules/${rules.id}`)}
                  />
                </View>
              ))}
            </Panel>
          </Section>
        );
      })}

      <Section title="Build your own">
        <Button
          label="New Ruleset"
          block
          icon={<PlusIcon size={18} color={colors.ink} />}
          onPress={() => router.push('/rules/edit')}
        />
        <Caption tone="faint" style={styles.note}>
          Start from a preset and change what differs.
        </Caption>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: space.md, marginBottom: space.xs },
  note: { marginTop: space.md, paddingHorizontal: space.xs },
});
