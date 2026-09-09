import React, { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TileScanner } from '@/design/components';
import { colors, type } from '@/design/tokens';
import { useOtaUpdates } from '@/lib/updates';
import { initAccount } from '@/store/account';
import { hydrateFriends } from '@/store/friends';
import { syncNow } from '@/store/sync/engine';
import { hydrate } from '@/store/store';

/**
 * Root navigation.
 *
 * The app is dark-only by deliberate choice, so there is no theme switching
 * here - the status bar, the navigator background and the splash all name the
 * same ground colour, which is what stops the white flash between the splash
 * screen and the first frame.
 *
 * It is also where over-the-air updates land. They apply without asking, so
 * the one thing owed to the player is an explanation of why the app just
 * restarted itself - hence the panel, which is the only thing standing between
 * a silent reload and looking like a crash.
 */
export default function RootLayout() {
  useEffect(() => {
    void hydrate();
    // The cached friends list, so the picker on a session screen has names in
    // it before - and without - any network.
    void hydrateFriends();
    // Anonymous, silent, and allowed to fail: offline is an ordinary outcome
    // and leaves the app exactly as it was before accounts existed. Sync
    // follows whenever it succeeds, and again on every return to the
    // foreground, which is the cheapest signal that the network may be back.
    void initAccount().then(() => syncNow());
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void syncNow();
    });
    return () => sub.remove();
  }, []);

  const updateStatus = useOtaUpdates();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.ground },
          headerTintColor: colors.ink,
          headerTitleStyle: { ...type.heading, color: colors.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.ground },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="session/[id]" options={{ title: '' }} />
        <Stack.Screen name="hand/capture" options={{ title: 'Photograph the Hand' }} />
        <Stack.Screen name="hand/review" options={{ title: 'Check the Tiles' }} />
        <Stack.Screen name="hand/result" options={{ title: 'The Tally' }} />
        <Stack.Screen name="rules/[id]" options={{ title: '' }} />
        <Stack.Screen name="rules/edit" options={{ title: 'Custom Rules' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="profile/[handle]" options={{ title: '' }} />
        <Stack.Screen name="away/[id]" options={{ title: '' }} />
      </Stack>

      {updateStatus === 'applying' ? (
        <View style={styles.updating}>
          <TileScanner label="Updating…" />
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  /** Covers the app for the moment between reloading and the new bundle. */
  updating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
});
