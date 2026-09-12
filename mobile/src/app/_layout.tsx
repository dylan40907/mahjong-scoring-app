import React, { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TileScanner } from '@/design/components';
import { colors } from '@/design/tokens';
import { useOtaUpdates } from '@/lib/updates';
import { initAccount } from '@/store/account';
import { hydrateFriends } from '@/store/friends';
import { startAutoSync, syncNow } from '@/store/sync/engine';
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
/**
 * The navigators' own background, in the ground colour.
 *
 * Every screen paints its own green, but the navigators underneath them ran on
 * the library's default light theme - rgb(242, 242, 242) - and a fast swipe
 * back uncovered it as a grey strip down the edge of the screen while the
 * next one slid in. Naming the ground here makes whatever shows between two
 * screens the same colour as both of them.
 *
 * Dark as the base, for the parts nothing here overrides; every bar is drawn
 * by the app itself, so the rest of the theme is never seen.
 */
const THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.ground,
    card: colors.ground,
    text: colors.ink,
    border: colors.line,
    primary: colors.brass,
    notification: colors.brass,
  },
};

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
    // After every change made here, and every few minutes while open.
    const stop = startAutoSync();
    return () => {
      sub.remove();
      stop();
    };
  }, []);

  const updateStatus = useOtaUpdates();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ThemeProvider value={THEME}>
        <Stack
          screenOptions={{
            // Nothing on this stack draws a platform bar; every screen brings
            // its own `PageHeader`, so the back arrow is the same arrow
            // everywhere instead of whatever the phone supplies.
            headerShown: false,
            contentStyle: { backgroundColor: colors.ground },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>

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
