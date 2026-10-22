import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MLogo, Wordmark } from '../components/Logo';
import { Txt } from '../components/Txt';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  const { state } = useApp();
  const progress = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withSequence(
      withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }),
      withDelay(150, withTiming(0, { duration: 250 })),
    );

    progress.value = withSequence(
      withTiming(1, { duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
      withDelay(200, withTiming(1.5, { duration: 200, easing: Easing.in(Easing.quad) })),
    );
  }, [progress, glow]);

  useEffect(() => {
    if (!state.hydrated) return;
    const timer = setTimeout(() => {
      navigation.replace('Main');
    }, 700);
    return () => clearTimeout(timer);
  }, [state.hydrated, navigation]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.7,
    transform: [{ scale: 0.8 + glow.value * 0.5 }],
  }));

  const logoStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1, 1.5], [0.82, 1, 1.28]);
    const opacity = interpolate(progress.value, [0, 0.3, 1, 1.5], [0, 1, 1, 0]);
    return {
      opacity,
      transform: [{ scale }],
      alignItems: 'center',
    };
  });

  const subtitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.6, 1, 1.5], [0, 0, 0.85, 0]);
    return {
      opacity,
      marginTop: 8,
    };
  });

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.glow, glowStyle]}>
        <Svg width={360} height={360}>
          <Defs>
            <RadialGradient id="cinatorGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={colors.red} stopOpacity={0.9} />
              <Stop offset="45%" stopColor={colors.red} stopOpacity={0.35} />
              <Stop offset="100%" stopColor={colors.red} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={180} cy={180} r={180} fill="url(#cinatorGlow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={logoStyle}>
        <MLogo size={110} />
        <View style={{ marginTop: 18 }}>
          <Wordmark size={36} />
        </View>
        <Animated.View style={subtitleStyle}>
          <Txt size={11} color={colors.textSoft} spacing={4} align="center">
            PREMIUM CINEMA
          </Txt>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 360, height: 360 },
});
