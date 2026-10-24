import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import AboutScreen from '../screens/AboutScreen';
import AdultContentScreen from '../screens/AdultContentScreen';
import AppSettingsScreen from '../screens/AppSettingsScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import DownloadsScreen from '../screens/DownloadsScreen';
import ImportExportScreen from '../screens/ImportExportScreen';
import LivePlayerScreen from '../screens/LivePlayerScreen';
import LiveTvScreen from '../screens/LiveTvScreen';
import ManageProfilesScreen from '../screens/ManageProfilesScreen';
import MyListScreen from '../screens/MyListScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import PlayerScreen from '../screens/PlayerScreen';
import ProvidersScreen from '../screens/ProvidersScreen';
import SearchScreen from '../screens/SearchScreen';
import SplashScreen from '../screens/SplashScreen';
import TitleScreen from '../screens/TitleScreen';
import { colors } from '../theme/tokens';
import { Tabs } from './Tabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; listener.remove(); };
  }, []);

  return (
    <Stack.Navigator
      initialRouteName="Main"
      screenOptions={{
        headerShown: false,
        orientation: 'portrait_up',
        animation: reduceMotion ? 'none' : 'slide_from_right',
        animationDuration: 180,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Splash" component={SplashScreen} options={{ animation: 'none' }} />
      <Stack.Screen name="Main" component={Tabs} options={{ animation: 'none' }} />
      <Stack.Screen name="Title" component={TitleScreen} />
      <Stack.Screen name="Player" component={PlayerScreen} options={{ orientation: 'landscape', animation: reduceMotion ? 'none' : 'fade', navigationBarHidden: true, statusBarHidden: true }} />
      <Stack.Screen name="Live" component={LivePlayerScreen} options={{ orientation: 'landscape', animation: reduceMotion ? 'none' : 'fade', navigationBarHidden: true, statusBarHidden: true }} />
      <Stack.Screen name="LiveTv" component={LiveTvScreen} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ animation: reduceMotion ? 'none' : 'fade' }} />
      <Stack.Screen name="Categories" component={CategoriesScreen} options={{ presentation: 'transparentModal', animation: reduceMotion ? 'none' : 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      <Stack.Screen name="MyList" component={MyListScreen} />
      <Stack.Screen name="Downloads" component={DownloadsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="AppSettings" component={AppSettingsScreen} />
      <Stack.Screen name="Providers" component={ProvidersScreen} />
      <Stack.Screen name="ManageProfiles" component={ManageProfilesScreen} />
      <Stack.Screen name="AdultContent" component={AdultContentScreen} />
      <Stack.Screen name="ImportExport" component={ImportExportScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
    </Stack.Navigator>
  );
}
