import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { CreditPopup } from '../components/CreditPopup';
import AnimeScreen from '../screens/AnimeScreen';
import HomeScreen from '../screens/HomeScreen';
import KDramaScreen from '../screens/KDramaScreen';
import ProfilesScreen from '../screens/ProfilesScreen';
import { useApp } from '../state/AppState';
import { colors, font } from '../theme/tokens';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

function ProfileTabIcon({ focused }: { focused: boolean }) {
  const { activeProfile } = useApp();
  if (!activeProfile) return <Ionicons name="person-circle-outline" size={26} color={focused ? colors.text : colors.textDim} />;
  return (
    <View style={{ padding: 1.5, borderRadius: 5, borderWidth: 1.5, borderColor: focused ? colors.text : 'transparent' }}>
      <Avatar profile={activeProfile} size={22} radius={3} />
    </View>
  );
}

export function Tabs() {
  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textDim,
          tabBarStyle: { backgroundColor: 'rgba(0,0,0,0.97)', borderTopWidth: 0, elevation: 0 },
          tabBarLabelStyle: { fontFamily: font.medium, fontSize: 10 },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'Home',
            tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />,
          }}
        />
        <Tab.Screen
          name="Anime"
          component={AnimeScreen}
          options={{
            title: 'Anime',
            tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'sparkles' : 'sparkles-outline'} size={24} color={color} />,
          }}
        />
        <Tab.Screen
          name="KDrama"
          component={KDramaScreen}
          options={{
            title: 'K-Drama',
            tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'film' : 'film-outline'} size={24} color={color} />,
          }}
        />
        <Tab.Screen
          name="Profiles"
          component={ProfilesScreen}
          options={{
            title: 'Profiles',
            tabBarIcon: ({ focused }) => <ProfileTabIcon focused={focused} />,
          }}
        />
      </Tab.Navigator>
      <CreditPopup />
    </>
  );
}
