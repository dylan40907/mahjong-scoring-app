import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, type } from '@/design/tokens';
import { hydrate } from '@/store/store';

/**
 * Root navigation.
 *
 * The app is dark-only by deliberate choice, so there is no theme switching
 * here - the status bar, the navigator background and the splash all name the
 * same ground colour, which is what stops the white flash between the splash
 * screen and the first frame.
 */
export default function RootLayout() {
  useEffect(() => {
    void hydrate();
  }, []);

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
        <Stack.Screen name="hand/context" options={{ title: 'How It Was Won' }} />
        <Stack.Screen name="hand/result" options={{ title: 'Score' }} />
        <Stack.Screen name="rules/[id]" options={{ title: '' }} />
        <Stack.Screen name="rules/edit" options={{ title: 'Custom Rules' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
