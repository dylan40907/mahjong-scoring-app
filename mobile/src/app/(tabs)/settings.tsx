import React, { useCallback } from 'react';
import { Alert, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import {
  Button,
  Caption,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
  Toggle,
} from '@/design/components';
import { space } from '@/design/tokens';
import { allRuleSets, updateSettings, useAppState } from '@/store/store';
import { clearAll } from '@/store/persistence';

export default function SettingsScreen() {
  const settings = useAppState(useCallback((state) => state.settings, []));
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const defaultRules = allRuleSets().find((r) => r.id === settings.defaultRuleSetId);

  const confirmReset = () => {
    Alert.alert(
      'Erase all data?',
      'Every session, hand and custom ruleset on this device will be removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            void clearAll();
          },
        },
      ],
    );
  };

  return (
    <Screen scroll>
      <Section title="Reading hands" first>
        <Panel flush>
          <Toggle
            label="Read tiles from photos"
            hint="Turn off to type every hand in."
            value={settings.detectionEnabled}
            onChange={(detectionEnabled) => updateSettings({ detectionEnabled })}
          />
        </Panel>
      </Section>

      <Section title="Defaults">
        <Panel flush>
          <Row title="Default ruleset" value={defaultRules?.name ?? 'None'} />
          <Divider inset={space.lg} />
          <Toggle
            label="Haptics"
            hint="A tap when a hand is scored."
            value={settings.hapticsEnabled}
            onChange={(hapticsEnabled) => updateSettings({ hapticsEnabled })}
          />
        </Panel>
      </Section>

      <Section title="About">
        <Panel flush>
          <Row title="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
          <Divider inset={space.lg} />
          <Row title="Sessions stored" value={String(sessions.length)} />
          <Divider inset={space.lg} />
          <Row
            title="Hands scored"
            value={String(sessions.reduce((sum, s) => sum + s.hands.length, 0))}
          />
        </Panel>
        <Caption tone="faint" style={styles.note}>
          Everything stays on this device. Nothing is uploaded.
        </Caption>
      </Section>

      <Section title="Data">
        <Button label="Erase all data" variant="danger" block onPress={confirmReset} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.md, paddingHorizontal: space.xs },
});
