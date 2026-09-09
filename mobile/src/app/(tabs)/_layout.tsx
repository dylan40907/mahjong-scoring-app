import React from 'react';
import { Tabs } from 'expo-router';
import { FriendsIcon, PersonIcon, RulesIcon, SessionsIcon } from '@/design/icons';
import { colors, type } from '@/design/tokens';
import { resetDraft } from '@/store/draft';

/**
 * Four tabs, in the order the app is used.
 *
 * Settings is not one of them any more. It had shrunk to a single preference,
 * two legal links and a destructive button, which is not a quarter of an app -
 * and its icon was a set of sliders sitting next to the Rules icon, also a set
 * of sliders. It lives behind a gear on the sessions screen now.
 *
 * "You" is a person rather than the four-seat table mark it used to carry.
 * That mark means "players", which is what a session has; this tab is one
 * person's own record, and a silhouette is the one place a generic glyph beats
 * a game-drawn one because every other app has already taught it.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.ground },
        headerTintColor: colors.ink,
        headerTitleStyle: { ...type.heading, color: colors.ink },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.ground },
        tabBarStyle: {
          backgroundColor: colors.well,
          borderTopColor: colors.line,
          borderTopWidth: 1,
        },
        // The one place navigation is allowed the accent. "Where am I" is a
        // primary state, and on a screen that is otherwise one hue it is also
        // the cheapest colour in the app.
        tabBarActiveTintColor: colors.brass,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
      }}
    >
      <Tabs.Screen
        name="(sessions)"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <SessionsIcon size={22} color={color} />,
          // The tab holds a stack now, and every screen in it draws its own
          // header, so the tab's own bar would be a second one.
          headerShown: false,
        }}
        listeners={({ navigation }) => ({
          /*
           * Tapping Sessions while already in Sessions abandons the hand.
           *
           * React Navigation already pops the stack to its root here; what it
           * cannot know is that a half-entered hand is still sitting in the
           * draft. Leaving it there means the next hand starts holding the
           * tiles of the one somebody walked away from, which is the kind of
           * bug that gets noticed as a wrong score rather than as stale state.
           *
           * Only on a second tap. The first is how you get *back* to a hand
           * you stepped away from, and that has to stay lossless.
           */
          tabPress: () => {
            if (navigation.isFocused()) resetDraft();
          },
        })}
      />
      <Tabs.Screen
        name="rules"
        options={{
          title: 'Rules',
          tabBarIcon: ({ color }) => <RulesIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <PersonIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color }) => <FriendsIcon size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
