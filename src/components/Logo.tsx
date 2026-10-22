import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { Txt } from './Txt';

/**
 * Premium-grade Cinator Emblem.
 * Sleek, multifaceted cinematic "C" mark with ruby crimson gradients and sharp aerodynamic bevels.
 */
export function MLogo({ size = 32 }: { size?: number }) {
  const width = Math.round((size * 88) / 100);
  return (
    <Svg width={width} height={size} viewBox="0 0 100 114" fill="none">
      <Defs>
        <LinearGradient id="rubyMain" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#FF2E38" />
          <Stop offset="50%" stopColor="#E50914" />
          <Stop offset="100%" stopColor="#8A0207" />
        </LinearGradient>
        <LinearGradient id="rubyGlow" x1="100%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#FF6B72" />
          <Stop offset="60%" stopColor="#E50914" />
          <Stop offset="100%" stopColor="#B3040B" />
        </LinearGradient>
        <LinearGradient id="rubyDark" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#990208" />
          <Stop offset="100%" stopColor="#4A0003" />
        </LinearGradient>
      </Defs>

      {/* Outer Lower Wing */}
      <Path
        d="M24 74 L46 62 L84 86 L62 108 L18 84 Z"
        fill="url(#rubyDark)"
      />

      {/* Main Back Spine & Central Body */}
      <Path
        d="M20 28 L48 12 L48 102 L20 86 Z"
        fill="url(#rubyMain)"
      />

      {/* Upper Leading Wing */}
      <Path
        d="M20 28 L78 6 L88 24 L48 48 L20 28 Z"
        fill="url(#rubyGlow)"
      />

      {/* Lower Sweeping Wing */}
      <Path
        d="M48 66 L88 90 L76 108 L20 86 L48 66 Z"
        fill="url(#rubyMain)"
      />

      {/* Facet Shading Highlight */}
      <Path
        d="M20 28 L48 48 L48 66 L20 86 Z"
        fill="url(#rubyDark)"
        opacity={0.45}
      />

      {/* Inner Cinema Shutter Apex */}
      <Path
        d="M48 44 L68 57 L48 70 Z"
        fill="#FFFFFF"
        opacity={0.92}
      />
    </Svg>
  );
}

export function Wordmark({ size = 32 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Txt weight="display" size={size} color={colors.red} spacing={3} lineHeight={size * 1.05}>
        CINATOR
      </Txt>
    </View>
  );
}
