import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from '@expo-google-fonts/inter';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Toast } from './src/components/Toast';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppStateProvider } from './src/state/AppState';
import { colors } from './src/theme/tokens';

// Prevent native splash screen from auto-hiding before React root mounts
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.red,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: 'transparent',
    notification: colors.red,
  },
};

export default function App() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    BebasNeue_400Regular,
  });

  const [fontTimedOut, setFontTimedOut] = useState(false);
  const splashDismissedRef = useRef(false);

  const dismissNativeSplash = useCallback(async () => {
    if (!splashDismissedRef.current) {
      splashDismissedRef.current = true;
      try {
        await SplashScreen.hideAsync();
      } catch {}
    }
  }, []);

  // Failsafe font timeout: never allow font loading to block startup indefinitely
  useEffect(() => {
    const timer = setTimeout(() => {
      setFontTimedOut(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const ready = loaded || !!error || fontTimedOut;

  useEffect(() => {
    if (ready) {
      dismissNativeSplash();
    }
  }, [ready, dismissNativeSplash]);

  // Top-level absolute safety timeout: native splash MUST hide within 1800ms under any condition
  useEffect(() => {
    const timer = setTimeout(() => {
      dismissNativeSplash();
    }, 1800);
    return () => clearTimeout(timer);
  }, [dismissNativeSplash]);

  const onLayoutRootView = useCallback(async () => {
    if (ready) {
      await dismissNativeSplash();
    }
  }, [ready, dismissNativeSplash]);

  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayoutRootView}>
        <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
          <AppStateProvider>
            <NavigationContainer theme={theme}>
              <StatusBar style="light" />
              <RootNavigator />
            </NavigationContainer>
            <Toast />
          </AppStateProvider>
        </SafeAreaProvider>
      </View>
    </ErrorBoundary>
  );
}
