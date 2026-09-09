import React, { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import {
  Button,
  Caption,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
} from '@/design/components';
import { CheckIcon, RulesIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { allRuleSets, updateSettings, useAppState } from '@/store/store';
import { clearAll } from '@/store/persistence';
import { LEGAL } from '@/lib/legal';

/**
 * Settings.
 *
 * Deliberately short. Two switches used to live here and neither earned its
 * place: "read tiles from photos" duplicated a decision the player already
 * made when they granted camera access, and haptics is something every phone
 * turns off globally in its own settings. A preference that exists only
 * because it was easy to add is a question the app asks and then ignores.
 *
 * What is left is the one genuine preference - which ruleset a new session
 * starts on - and it is now something you can actually change, which it was
 * not: it showed the current value and did nothing when tapped.
 */
export default function SettingsScreen() {
  const settings = useAppState(useCallback((state) => state.settings, []));
  useAppState(useCallback((state) => state.customRuleSets, []));

  const rulesets = allRuleSets();
  const defaultRules = rulesets.find((r) => r.id === settings.defaultRuleSetId);
  const [picking, setPicking] = useState(false);

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
    <Screen scroll motif="wall">
      <Section title="Defaults" icon={<RulesIcon size={15} color={colors.inkFaint} />} first>
        <Panel flush>
          <Row
            title="New sessions use"
            value={defaultRules?.name ?? 'None'}
            onPress={() => setPicking(!picking)}
            chevron={!picking}
          />
          {/*
            * The list opens in place rather than on a screen of its own.
            * Choosing a ruleset is one tap either side of one decision, and a
            * pushed screen would cost two more for the navigation around it.
            */}
          {picking ? (
            <View>
              {rulesets.map((rules) => (
                <View key={rules.id}>
                  <Divider inset={space.lg} />
                  <Row
                    title={rules.name}
                    subtitle={rules.subtitle}
                    trailing={
                      rules.id === settings.defaultRuleSetId ? (
                        <CheckIcon size={18} color={colors.brass} />
                      ) : undefined
                    }
                    chevron={false}
                    onPress={() => {
                      updateSettings({ defaultRuleSetId: rules.id });
                      setPicking(false);
                    }}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Panel>
      </Section>

      {/*
        * No counts here any more. "Sessions stored" and "Hands scored" are the
        * same two numbers the profile shows, said worse - without knowing which
        * of the four players you were, so they could not agree with it either.
        * The profile is where a record of what you have played belongs.
        */}

      {/*
        * Both stores want these reachable from inside the app, not only from
        * the listing, and somebody looking for them is looking for them here.
        * They open in the browser rather than in a screen of their own: the
        * text lives at a URL that has to exist anyway, and a second copy
        * bundled into the app is a second copy to keep current.
        */}
      <Section title="Legal">
        <Panel flush>
          <Row
            title="Privacy policy"
            onPress={() => void Linking.openURL(LEGAL.privacy)}
          />
          <Divider inset={space.lg} />
          <Row title="Terms of use" onPress={() => void Linking.openURL(LEGAL.terms)} />
        </Panel>
      </Section>

      <Section title="Data">
        <Button label="Erase all data" variant="danger" block onPress={confirmReset} />
      </Section>

      {/* Small, and at the bottom, because nobody opens Settings to read it. */}
      <Caption tone="faint" center style={styles.version}>
        Tile Tally {Constants.expoConfig?.version ?? '1.0.0'}
      </Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.md, paddingHorizontal: space.xs },
  version: { marginTop: space.xxxl },
});
