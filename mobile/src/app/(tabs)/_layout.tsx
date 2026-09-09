import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { FriendsIcon, GearIcon, PersonIcon, RulesIcon, SessionsIcon } from '@/design/icons';
import { colors, space, type } from '@/design/tokens';

/**
 * Settings, in the corner of the first screen.
 *
 * It used to be a quarter of the tab bar and was one preference, two legal
 * links and a destructive button - and its icon was a set of sliders sitting
 * beside Rules, also a set of sliders. A gear in the top corner is where every
 * other app keeps this, and it gives the fourth tab to something people open.
 */
function SettingsButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={space.md}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <GearIcon size={22} color={colors.inkMuted} />
    </Pressable>
  );
}

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
        name="index"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <SessionsIcon size={22} color={color} />,
          headerRight: () => <SettingsButton />,
        }}
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
          title: 'You',
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

const styles = StyleSheet.create({
  gear: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  pressed: { opacity: 0.6 },
});
