import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '@/design/tokens';

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
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      {/*
        * No bars. Every screen in here draws its own with `PageHeader`, so
        * that a back arrow is the same arrow in the same place throughout the
        * app rather than whatever the platform supplies on the phone in hand.
        */}
    </Stack>
  );
}

