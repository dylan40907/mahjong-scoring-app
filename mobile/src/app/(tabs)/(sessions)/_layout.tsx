import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { GearIcon } from '@/design/icons';
import { colors, space, type } from '@/design/tokens';

/**
 * The Sessions tab's own stack.
 *
 * Everything from the list to the tally lives in here rather than on the root
 * stack, and that placement is the whole feature: a screen pushed on the root
 * stack covers the tab bar, so opening a table used to take the navigation
 * away and scoring a hand kept it away for four screens. Nested, the bar stays
 * put and the stack slides underneath it.
 *
 * It buys two behaviours for free, both of which are what a tab bar is
 * expected to do:
 *
 *   Leaving mid-hand and coming back returns to where you were. Each tab keeps
 *   its own history, so tapping Profile halfway through entering tiles and
 *   then tapping Sessions lands back on the tiles rather than on the list.
 *
 *   Tapping Sessions while already in Sessions pops to the list. React
 *   Navigation does that as standard; what the tab layout adds is throwing the
 *   half-entered hand away at the same time, because a draft that survives its
 *   own screen being dismissed comes back to haunt the next hand.
 */
export default function SessionsLayout() {
  return (
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
      {/*
        * The list keeps a real header, and it is the stack's rather than the
        * tab's: a tab header plus a stack header is two bars stacked on the
        * same screen. Settings lives in its corner because it is one
        * preference, two legal links and a destructive button - not a quarter
        * of the tab bar, and not an icon of sliders sitting beside Rules,
        * which is also an icon of sliders.
        */}
      <Stack.Screen
        name="index"
        options={{ title: 'Sessions', headerRight: () => <SettingsButton /> }}
      />
      <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="hand/capture" options={{ title: 'Photograph the Hand' }} />
      <Stack.Screen name="hand/review" options={{ title: 'Check the Tiles' }} />
      <Stack.Screen name="hand/result" options={{ title: 'The Tally' }} />
      <Stack.Screen name="away/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

function SettingsButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <GearIcon size={22} color={colors.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gear: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  pressed: { opacity: 0.6 },
});
