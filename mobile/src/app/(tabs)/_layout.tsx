import React from 'react';
import { Tabs } from 'expo-router';
import { RulesIcon, SessionsIcon, SettingsIcon } from '@/design/icons';
import { colors, type } from '@/design/tokens';

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
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
