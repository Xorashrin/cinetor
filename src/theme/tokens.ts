import { Easing } from 'react-native-reanimated';

// Cinetor uses warm coral on dark ink. Legacy color names remain API aliases.
export const colors = {
  accent: '#FF967E',
  accentPressed: '#E97E67',
  accentSoft: '#33252A',
  onAccent: '#21130F',
  red: '#FF967E',
  redPressed: '#E97E67',
  redLight: '#FFB29F',
  blue: '#A1C8FF',

  bg: '#0B1017',
  surface0: '#101720',
  surface1: '#151E29',
  surface2: '#1C2735',
  surface3: '#243142',
  surface4: '#2C3A4C',
  surface5: '#35455A',
  surface6: '#455870',
  border: '#526379',
  borderSubtle: '#2B3849',

  text: '#F6F2ED',
  text90: '#E9E7E4',
  text80: '#D2D7DF',
  text70: '#BCC7D4',
  textMuted: '#BCC7D4',
  textSoft: '#D2D7DF',
  textDim: '#A3B1C2',
  textFaint: '#9BA9BA',
  link: '#FFB29F',

  success: '#9AD5AE',
  warning: '#F1C887',
  danger: '#FFB3AD',
  love: '#FFB29F',
  scrim: 'rgba(4,8,13,0.62)',
  overlay: 'rgba(4,8,13,0.94)',
  glassButton: 'rgba(28,39,53,0.94)',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
  display: 'Inter_700Bold',
} as const;

export type FontWeight = keyof typeof font;

export const textSize = {
  micro: 11,
  caption: 12,
  small: 13,
  body: 15,
  bodyLarge: 17,
  title: 19,
  heading: 24,
  display: 32,
} as const;

export const motion = {
  fast: 120,
  base: 180,
  slow: 240,
  slower: 320,
  standard: Easing.bezier(0.4, 0, 0.2, 1),
  decelerate: Easing.bezier(0, 0, 0.2, 1),
  accelerate: Easing.bezier(0.4, 0, 1, 1),
} as const;

export const layout = {
  gutter: 16,
  headerHeight: 64,
  chipRowHeight: 56,
  tabBarHeight: 72,
  minTouchTarget: 48,
  maxContentWidth: 840,
} as const;
