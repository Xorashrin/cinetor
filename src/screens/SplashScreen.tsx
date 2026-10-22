import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { MLogo, Wordmark } from '../components/Logo';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, motion } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  const { state } = useApp();
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(withTiming(1, { duration: 180 }), withDelay(400, withTiming(0, { duration: 200 })));
    scale.value = withSequence(withTiming(1, { duration: 250, easing: motion.decelerate }), withDelay(350, withTiming(1.6, { duration: 200, easing: motion.accelerate })));
    glow.value = withDelay(100, withSequence(withTiming(1, { duration: 250 }), withTiming(0, { duration: 250 })));
  }, [opacity, scale, glow]);

  useEffect(() => {
    if (!state.hydrated) return;
    const timer = setTimeout(() => {
      navigation.replace('Main');
    }, 650);
    return () => clearTimeout(timer);
  }, [state.hydrated, navigation]);

  const logoStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }], alignItems: 'center' }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value * 0.6, transform: [{ scale: 0.8 + glow.value * 0.4 }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.glow, glowStyle]}>
        <Svg width={320} height={320}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.red} stopOpacity={0.9} />
              <Stop offset="1" stopColor={colors.red} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={160} cy={160} r={160} fill="url(#glow)" />
        </Svg>
      </Animated.View>
      <Animated.View style={logoStyle}>
        <MLogo size={100} />
        <View style={{ marginTop: 16 }}>
          <Wordmark size={32} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 320, height: 320 },
});
