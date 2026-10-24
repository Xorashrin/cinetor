import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { Txt } from './Txt';

/** An open frame and a single projection window form Cinetor's original C mark. */
export function CinetorMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" accessible={false}>
      <Rect width="64" height="64" rx="19" fill={colors.surface2} />
      <Path
        d="M44 19H31C23.82 19 18 24.82 18 32C18 39.18 23.82 45 31 45H44"
        stroke={colors.accent}
        strokeWidth="7"
        strokeLinecap="round"
      />
      <Rect x="40" y="27" width="10" height="10" rx="3" fill={colors.accent} />
    </Svg>
  );
}

// Keep the existing import name for screens outside the redesigned shell.
export const MLogo = CinetorMark;

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Txt weight="bold" size={size} spacing={-0.7} lineHeight={size * 1.25} accessibilityLabel="Cinetor" allowFontScaling={false}>
      Cinetor
    </Txt>
  );
}
