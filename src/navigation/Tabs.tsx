import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '../components/Txt';
import AnimeScreen from '../screens/AnimeScreen';
import HomeScreen from '../screens/HomeScreen';
import KDramaScreen from '../screens/KDramaScreen';
import OthersScreen from '../screens/OthersScreen';
import ProfilesScreen from '../screens/ProfilesScreen';
import { colors, layout, radius } from '../theme/tokens';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
type IconName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({ focused, icon, color }: { focused: boolean; icon: IconName; color: string }) {
  return (
    <View style={[styles.icon, focused && styles.activeIcon]}>
      <Ionicons name={icon} size={23} color={color} accessible={false} />
    </View>
  );
}

export function Tabs() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarAllowFontScaling: true,
        tabBarStyle: {
          backgroundColor: colors.surface0,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: layout.tabBarHeight + insets.bottom + Math.max(0, fontScale - 1) * 44,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          elevation: 0,
        },
        tabBarItemStyle: { minWidth: layout.minTouchTarget, minHeight: layout.minTouchTarget, paddingHorizontal: 1 },
        tabBarLabel: ({ color }) => <Txt weight="semibold" size={11} color={color} align="center" style={styles.label}>{route.name === 'KDrama' ? 'K-Drama' : route.name}</Txt>,
        sceneStyle: { backgroundColor: colors.bg },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home', tabBarAccessibilityLabel: 'Home catalog', tabBarIcon: ({ focused, color }) => <TabIcon focused={focused} color={color} icon={focused ? 'home' : 'home-outline'} /> }} />
      <Tab.Screen name="Anime" component={AnimeScreen} options={{ title: 'Anime', tabBarAccessibilityLabel: 'Anime catalog', tabBarIcon: ({ focused, color }) => <TabIcon focused={focused} color={color} icon={focused ? 'sparkles' : 'sparkles-outline'} /> }} />
      <Tab.Screen name="KDrama" component={KDramaScreen} options={{ title: 'K-Drama', tabBarAccessibilityLabel: 'K-Drama catalog', tabBarIcon: ({ focused, color }) => <TabIcon focused={focused} color={color} icon={focused ? 'film' : 'film-outline'} /> }} />
      <Tab.Screen name="Others" component={OthersScreen} options={{ title: 'Others', tabBarAccessibilityLabel: 'Others catalog', tabBarIcon: ({ focused, color }) => <TabIcon focused={focused} color={color} icon={focused ? 'albums' : 'albums-outline'} /> }} />
      <Tab.Screen name="Profiles" component={ProfilesScreen} options={{ title: 'Profiles', tabBarAccessibilityLabel: 'Profiles and settings', tabBarIcon: ({ focused, color }) => <TabIcon focused={focused} color={color} icon={focused ? 'person-circle' : 'person-circle-outline'} /> }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  icon: { minWidth: 48, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  activeIcon: { backgroundColor: colors.accentSoft },
  label: { alignSelf: 'stretch', marginTop: 4, paddingHorizontal: 1 },
});
