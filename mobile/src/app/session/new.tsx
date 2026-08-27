import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Caption,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
  TextField,
} from '@/design/components';
import { CheckIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { BUILT_IN_RULESETS } from '@/scoring';
import { createSession, useAppState } from '@/store/store';

/**
 * Creating a session.
 *
 * The ruleset is chosen here rather than per hand, because changing scoring
 * rules mid-session would make the running totals meaningless. Seats are
 * assigned in listed order - East first - which matches how people sit down.
 */
export default function NewSessionScreen() {
  const router = useRouter();
  const settings = useAppState(useCallback((state) => state.settings, []));
  const custom = useAppState(useCallback((state) => state.customRuleSets, []));

  const [name, setName] = useState('');
  const [ruleSetId, setRuleSetId] = useState(settings.defaultRuleSetId);
  const [players, setPlayers] = useState(['', '', '', '']);

  const allRules = [...BUILT_IN_RULESETS, ...custom];
  const namedPlayers = players.filter((player) => player.trim().length > 0);
  const canCreate = namedPlayers.length >= 2;

  const create = () => {
    const session = createSession({
      name: name.trim() || defaultName(),
      ruleSetId,
      playerNames: players.map((p, i) => p.trim() || `Player ${i + 1}`),
    });
    router.replace(`/session/${session.id}`);
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section title="Session" first>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={defaultName()}
            label="Name"
          />
        </Section>

        <Section title="Players" note="Seated East first">
          <View style={styles.players}>
            {players.map((player, index) => (
              <TextField
                key={index}
                value={player}
                onChangeText={(value) =>
                  setPlayers((current) => current.map((p, i) => (i === index ? value : p)))
                }
                placeholder={`Player ${index + 1}`}
                label={SEAT_LABELS[index]}
              />
            ))}
          </View>
        </Section>

        <Section title="Scoring rules">
          <Panel flush>
            {allRules.map((rules, index) => (
              <View key={rules.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={rules.name}
                  subtitle={rules.subtitle}
                  onPress={() => setRuleSetId(rules.id)}
                  chevron={false}
                  trailing={
                    rules.id === ruleSetId ? (
                      <CheckIcon size={18} color={colors.brass} strokeWidth={2.2} />
                    ) : null
                  }
                />
              </View>
            ))}
          </Panel>
          <Caption tone="faint" style={styles.note}>
            Rules apply to the whole session, so the running totals stay comparable.
          </Caption>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Start Session"
          variant="primary"
          block
          disabled={!canCreate}
          onPress={create}
        />
        {!canCreate ? (
          <Caption tone="faint" center style={styles.footerNote}>
            Name at least two players.
          </Caption>
        ) : null}
      </View>
    </Screen>
  );
}

const SEAT_LABELS = ['East · dealer', 'South', 'West', 'North'];

function defaultName(): string {
  return new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

const styles = StyleSheet.create({
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  players: { gap: space.md },
  note: { marginTop: space.md, paddingHorizontal: space.xs },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
  footerNote: { marginTop: space.sm },
});
