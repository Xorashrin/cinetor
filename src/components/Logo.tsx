import React from 'react';
import { View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { Txt } from './Txt';

const BAR = '#B1060F';

export function MLogo({ size = 28 }: { size?: number }) {
  return (
    <Svg width={(size * 432) / 624} height={size} viewBox="296 200 432 624">
      <Polygon points="296,200 408,200 408,824 296,824" fill={BAR} />
      <Polygon points="616,200 728,200 728,824 616,824" fill={BAR} />
      <Polygon points="296,200 408,200 568,640 456,640" fill={colors.red} />
      <Polygon points="616,200 728,200 568,640 456,640" fill={colors.red} />
    </Svg>
  );
}

export function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <View>
      <Txt weight="display" size={size} color={colors.red} spacing={1.5} lineHeight={size * 1.05}>
        CINATOR
      </Txt>
    </View>
  );
}
